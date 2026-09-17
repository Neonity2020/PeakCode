// FILE: main.m
// Purpose: The native macOS computer-use helper — accessibility observation, element
//          actions, synthetic input and screen capture, behind a line-delimited JSON socket.
// Layer: Native helper (own process, own privacy grant)
// Build:   compiled by the desktop app at install time (apps/desktop/src/computerUseHelper.ts)
//          and by the release script for the copy that ships inside a packaged build
//          (scripts/build-desktop-artifact.ts). Both follow the recipe in
//          packages/shared/src/computerUseHelperBuild.ts.
//
// ## Why this is a separate app rather than code inside Electron
//
// macOS attributes an Accessibility or Screen Recording grant to the *responsible* process,
// and a child process inherits its parent's attribution. Measured on this machine:
//
//   - spawned as a child of an app        → uses the parent's grant
//   - launched through LaunchServices     → uses its own
//
// So this helper is launched as its own app, and the grant the user gives it is pinned to
// *its* signed identity. That matters because the dev build of the host app is ad-hoc signed
// and re-signed on every rebuild, which invalidates any grant filed against it. The helper's
// identity is stable across those rebuilds, so the user grants this once and keeps working.
//
// It also means the helper must not be a stdio child: it is started by LaunchServices and
// talks over a unix socket instead.
//
// ## Accessibility-first
//
// Element actions (`act`) address elements by ref and go through the accessibility API, which
// needs no focus change and never touches the real pointer. Synthetic input (`click`, `type`,
// `key`) is the fallback for targets the tree cannot express, and it does move the user's
// focus and pointer — the tool schema says so, and this file keeps that split honest rather
// than quietly routing everything through CGEvent.

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>

#import <errno.h>
#import <netinet/in.h>
#import <poll.h>
#import <signal.h>
#import <string.h>
#import <sys/socket.h>
#import <sys/stat.h>
#import <sys/un.h>
#import <unistd.h>

/** Bumped when the verb set or the shape of a result changes: an older helper left running
 *  would otherwise answer "unknown method" for a capability the caller knows exists. */
static const int kProtocolVersion = 2;
static const char *kHelperVersion = "1.1.0";

/** Bounds on one accessibility walk. A dense app can hold tens of thousands of nodes; the
 *  model needs the interesting ones, and an unbounded walk would stall the socket. */
static const NSInteger kMaxNodes = 1500;
static const NSInteger kMaxDepth = 24;

/** An app whose tree is this small is usually one that has not built its tree yet. */
static const NSInteger kSparseTreeThreshold = 5;

/** How long one accessibility round trip into the target app may take.
 *
 *  The framework default is generous enough that a wedged app makes a single attribute read
 *  feel like a hang; two seconds is long enough for a busy app to answer and short enough
 *  that a broken one stays a reported failure rather than a stalled socket. */
static const NSTimeInterval kMessagingTimeoutSeconds = 2.0;

/** How long a whole walk may take before it gives up and reports what it has. */
static const NSTimeInterval kWalkDeadlineSeconds = 6.0;

#pragma mark - Logging

/**
 * Everything goes to stderr, and from there into a file next to the helper's other state.
 *
 * LaunchServices starts this process and nothing is attached to its stderr, so without the
 * file the only record of a failure — a denied permission, a walk that timed out, a request
 * that never came back — would be lost. `redirectStderr` is what makes that record readable
 * when someone asks why the helper is not working.
 */
static void Log(NSString *format, ...) {
  va_list args;
  va_start(args, format);
  NSString *message = [[NSString alloc] initWithFormat:format arguments:args];
  va_end(args);
  fprintf(stderr, "[computer-use] %s\n", message.UTF8String);
}

static void RedirectStderr(NSString *directory) {
  [NSFileManager.defaultManager createDirectoryAtPath:directory
                          withIntermediateDirectories:YES
                                           attributes:nil
                                                error:nil];
  NSString *path = [directory stringByAppendingPathComponent:@"helper.log"];

  // Trimmed on start so the file describes this run rather than accumulating forever. A
  // helper that has been up for weeks would otherwise be unreadable.
  if ([NSFileManager.defaultManager fileExistsAtPath:path]) {
    NSDictionary *attributes = [NSFileManager.defaultManager attributesOfItemAtPath:path error:nil];
    unsigned long long size = [attributes[NSFileSize] unsignedLongLongValue];
    if (size > 256 * 1024) {
      [NSFileManager.defaultManager removeItemAtPath:path error:nil];
    }
  }

  freopen(path.fileSystemRepresentation, "a", stderr);
  // Redirecting stderr to a file switches it to fully buffered, which would hold the last
  // lines of a crashed or killed helper in memory — exactly the lines worth having. Keep it
  // unbuffered so the file is current the moment someone reads it.
  setvbuf(stderr, NULL, _IONBF, 0);
}

#pragma mark - JSON responses

static NSDictionary *ErrorBody(NSString *code, NSString *message) {
  return @{@"code" : code, @"message" : message};
}

/**
 * Build a response, carrying the request id only when there is one.
 *
 * Handlers that fail build their error before they know which request it answers, so they
 * pass a nil id and let `Dispatch` stamp it. Leaving the key out entirely — rather than
 * filling in a placeholder — is what makes that stamping detectable: a placeholder would be
 * indistinguishable from a real id, and the caller would never match the reply to its
 * request.
 */
static NSDictionary *ResponseWithResult(id requestId, id result) {
  NSMutableDictionary *response = [NSMutableDictionary dictionary];
  if (requestId) {
    response[@"id"] = requestId;
  }
  response[@"result"] = result ?: @{};
  return response;
}

static NSDictionary *ResponseWithError(id requestId, NSString *code, NSString *message) {
  NSMutableDictionary *response = [NSMutableDictionary dictionary];
  if (requestId) {
    response[@"id"] = requestId;
  }
  response[@"error"] = ErrorBody(code, message);
  return response;
}

#pragma mark - Permission state

static BOOL AccessibilityGranted(void) { return AXIsProcessTrusted(); }

static BOOL ScreenRecordingGranted(void) {
  // CGPreflightScreenCaptureAccess reports without prompting, which is what a status call
  // needs. The prompting variant is only reached through `request_access`.
  return CGPreflightScreenCaptureAccess();
}

#pragma mark - Accessibility element helpers

static NSString *CopyStringAttribute(AXUIElementRef element, CFStringRef attribute) {
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) {
    return nil;
  }
  NSString *result = nil;
  if (CFGetTypeID(value) == CFStringGetTypeID()) {
    result = [(__bridge NSString *)value copy];
  } else if (CFGetTypeID(value) == CFNumberGetTypeID() || CFGetTypeID(value) == CFBooleanGetTypeID()) {
    result = [(__bridge id)value description];
  }
  CFRelease(value);
  return result;
}

static BOOL CopyBoolAttribute(AXUIElementRef element, CFStringRef attribute, BOOL *out) {
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) {
    return NO;
  }
  BOOL ok = NO;
  if (CFGetTypeID(value) == CFBooleanGetTypeID()) {
    *out = CFBooleanGetValue((CFBooleanRef)value);
    ok = YES;
  }
  CFRelease(value);
  return ok;
}

static BOOL CopyPointAttribute(AXUIElementRef element, CFStringRef attribute, CGPoint *out) {
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) {
    return NO;
  }
  BOOL ok = NO;
  if (CFGetTypeID(value) == AXValueGetTypeID()) {
    ok = AXValueGetValue((AXValueRef)value, kAXValueCGPointType, out);
  }
  CFRelease(value);
  return ok;
}

static BOOL CopySizeAttribute(AXUIElementRef element, CFStringRef attribute, CGSize *out) {
  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) {
    return NO;
  }
  BOOL ok = NO;
  if (CFGetTypeID(value) == AXValueGetTypeID()) {
    ok = AXValueGetValue((AXValueRef)value, kAXValueCGSizeType, out);
  }
  CFRelease(value);
  return ok;
}

static NSArray<NSString *> *CopyActionNames(AXUIElementRef element) {
  CFArrayRef actions = NULL;
  if (AXUIElementCopyActionNames(element, &actions) != kAXErrorSuccess || !actions) {
    return @[];
  }
  NSMutableArray<NSString *> *names = [NSMutableArray array];
  for (CFIndex i = 0; i < CFArrayGetCount(actions); i++) {
    CFStringRef name = (CFStringRef)CFArrayGetValueAtIndex(actions, i);
    if (name && CFGetTypeID(name) == CFStringGetTypeID()) {
      [names addObject:(__bridge NSString *)name];
    }
  }
  CFRelease(actions);
  return names;
}

/**
 * Ask an app to build its accessibility tree.
 *
 * Plenty of apps — including most Electron ones and several chat clients — publish almost
 * nothing until they are told a client is listening. Setting these two attributes is that
 * request. Without it those apps look like a four-node tree with no named controls, which
 * pushes a caller straight to coordinate clicking for no good reason.
 */
static void RequestManualAccessibility(AXUIElementRef app) {
  for (NSString *attribute in @[ @"AXEnhancedUserInterface", @"AXManualAccessibility" ]) {
    AXUIElementSetAttributeValue(app, (__bridge CFStringRef)attribute, kCFBooleanTrue);
  }
}

static NSArray *CopyChildren(AXUIElementRef element, NSString *role) {
  // Probing both child attributes costs a round trip each, and on a tree of a few hundred
  // nodes that doubles the walk. Only containers that virtualise their content publish
  // AXVisibleChildren, and only those are worth the second probe — for everything else
  // AXChildren is the whole answer, and for a leaf it is one call that returns empty.
  NSArray<NSString *> *containerRoles = @[
    @"AXScrollArea", @"AXList", @"AXOutline", @"AXTable", @"AXBrowser", @"AXWebArea"
  ];

  if ([containerRoles containsObject:role ?: @""]) {
    CFTypeRef visible = NULL;
    if (AXUIElementCopyAttributeValue(element, CFSTR("AXVisibleChildren"), &visible) ==
            kAXErrorSuccess &&
        visible) {
      if (CFGetTypeID(visible) == CFArrayGetTypeID() && CFArrayGetCount((CFArrayRef)visible) > 0) {
        NSArray *children = [(__bridge NSArray *)visible copy];
        CFRelease(visible);
        return children;
      }
      CFRelease(visible);
    }
  }

  CFTypeRef value = NULL;
  if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &value) != kAXErrorSuccess ||
      !value) {
    return @[];
  }
  NSArray *children = @[];
  if (CFGetTypeID(value) == CFArrayGetTypeID()) {
    children = [(__bridge NSArray *)value copy];
  }
  CFRelease(value);
  return children;
}

#pragma mark - Observation state

/**
 * The one live observation.
 *
 * Refs are deliberately not durable across observations: a ref names a position in one tree,
 * and the element behind it may be a different control by the time the next call arrives.
 * Keeping only the latest observation makes "a ref from an older observation is refused" the
 * natural behaviour instead of a check that has to be remembered.
 */
static NSInteger gStateCounter = 0;
static NSString *gStateId = nil;
static NSMutableArray *gStateElements = nil; // boxed AXUIElementRef, retained

static void ReleaseObservation(void) {
  for (NSValue *box in gStateElements) {
    AXUIElementRef element = (AXUIElementRef)box.pointerValue;
    if (element) {
      CFRelease(element);
    }
  }
  [gStateElements removeAllObjects];
}

static void StoreObservation(NSArray *elements) {
  ReleaseObservation();
  gStateCounter += 1;
  gStateId = [NSString stringWithFormat:@"s%ld", (long)gStateCounter];
  gStateElements = [NSMutableArray arrayWithCapacity:elements.count];
  for (id element in elements) {
    AXUIElementRef reference = (__bridge AXUIElementRef)element;
    CFRetain(reference);
    [gStateElements addObject:[NSValue valueWithPointer:reference]];
  }
}

static AXUIElementRef ElementForRef(NSInteger ref) {
  if (ref < 0 || ref >= (NSInteger)gStateElements.count) {
    return NULL;
  }
  return (AXUIElementRef)((NSValue *)gStateElements[(NSUInteger)ref]).pointerValue;
}

#pragma mark - Tree rendering

static NSString *DescribeRole(NSString *role) {
  if (!role.length) {
    return @"element";
  }
  return [role hasPrefix:@"AX"] ? [role substringFromIndex:2] : role;
}

/**
 * One line per element, indented by depth.
 *
 * This is text rather than JSON because it is read by a model: role, name, geometry and the
 * actions that are actually available on the element. A model that can see `[press]` will use
 * it; one that has to guess between `press` and `set_value` will guess wrong.
 */
static void AppendElementLine(NSMutableString *out, AXUIElementRef element, NSInteger ref,
                              NSInteger depth, NSString *role) {
  NSMutableString *indent = [NSMutableString string];
  for (NSInteger i = 0; i < depth; i++) {
    [indent appendString:@"  "];
  }

  NSString *title = CopyStringAttribute(element, kAXTitleAttribute);
  NSString *description = CopyStringAttribute(element, kAXDescriptionAttribute);
  NSString *identifier = CopyStringAttribute(element, kAXIdentifierAttribute);

  NSString *name = title.length ? title : (description.length ? description : @"");
  if (!name.length && identifier.length) {
    name = [NSString stringWithFormat:@"#%@", identifier];
  }

  [out appendFormat:@"%@[%ld] %@", indent, (long)ref, DescribeRole(role)];
  if (name.length) {
    [out appendFormat:@" \"%@\"", name];
  }

  CGPoint position = CGPointZero;
  CGSize size = CGSizeZero;
  if (CopyPointAttribute(element, kAXPositionAttribute, &position) &&
      CopySizeAttribute(element, kAXSizeAttribute, &size)) {
    [out appendFormat:@" @(%.0f,%.0f) %.0fx%.0f", position.x, position.y, size.width, size.height];
  }

  // A value is only worth showing when it is short enough to be a control's content rather
  // than a document body; dumping a text view's whole contents would crowd out the tree.
  NSString *value = CopyStringAttribute(element, kAXValueAttribute);
  if (value.length && value.length <= 120 && ![value isEqualToString:name]) {
    [out appendFormat:@" value=\"%@\"", [value stringByReplacingOccurrencesOfString:@"\n" withString:@" "]];
  }

  NSMutableArray<NSString *> *verbs = [NSMutableArray array];
  for (NSString *action in CopyActionNames(element)) {
    if ([action isEqualToString:@"AXPress"]) {
      [verbs addObject:@"press"];
    } else if ([action isEqualToString:@"AXRaise"]) {
      [verbs addObject:@"raise"];
    } else if ([action isEqualToString:@"AXIncrement"]) {
      [verbs addObject:@"increment"];
    } else if ([action isEqualToString:@"AXDecrement"]) {
      [verbs addObject:@"decrement"];
    }
  }
  BOOL enabled = YES;
  if (CopyBoolAttribute(element, kAXEnabledAttribute, &enabled) && !enabled) {
    [verbs addObject:@"disabled"];
  }
  if (verbs.count) {
    [out appendFormat:@"  [%@]", [verbs componentsJoinedByString:@","]];
  }

  [out appendString:@"\n"];
}

/**
 * Walk one subtree into `out`, collecting the elements that refs address.
 *
 * Two bounds, both load-bearing. The node budget keeps a deep app from filling the caller's
 * context, and the deadline keeps an app that has stopped answering accessibility from
 * holding the socket — every attribute read is a round trip to another process, and a
 * process that is busy or blocked can make each one wait out the messaging timeout.
 */
static void WalkElement(AXUIElementRef element, NSInteger depth, NSMutableString *out,
                        NSMutableArray *collected, NSTimeInterval deadline, BOOL *timedOut) {
  if (depth > kMaxDepth || collected.count >= (NSUInteger)kMaxNodes || *timedOut) {
    return;
  }
  if (NSDate.date.timeIntervalSince1970 > deadline) {
    *timedOut = YES;
    return;
  }

  NSString *role = CopyStringAttribute(element, kAXRoleAttribute);
  NSInteger ref = (NSInteger)collected.count;
  [collected addObject:(__bridge id)element];
  AppendElementLine(out, element, ref, depth, role);

  for (id child in CopyChildren(element, role)) {
    if (collected.count >= (NSUInteger)kMaxNodes || *timedOut) {
      break;
    }
    WalkElement((__bridge AXUIElementRef)child, depth + 1, out, collected, deadline, timedOut);
  }
}

#pragma mark - Applications

static NSArray<NSString *> *KnownEnglishNamesForBundleId(NSString *bundleId);

static NSRunningApplication *FindApplication(NSString *nameOrBundleId, pid_t pid) {
  NSMutableArray<NSRunningApplication *> *candidates = [NSMutableArray array];
  for (NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications) {
    if (app.activationPolicy == NSApplicationActivationPolicyProhibited) {
      continue;
    }
    if (pid > 0) {
      if (app.processIdentifier == pid) {
        return app;
      }
      continue;
    }
    NSString *bundleId = app.bundleIdentifier ?: @"";
    // The name an app reports is localized, so it is not the name a caller is likely to pass:
    // on a Chinese system Finder calls itself 访达, and a caller asking for "Finder" is asking
    // for something real. Both spellings are matched, and so is the bundle id.
    NSString *localizedName = app.localizedName ?: @"";
    NSString *localizedLower = localizedName.lowercaseString;
    NSString *queryLower = nameOrBundleId.lowercaseString;

    if (bundleId.length && [bundleId caseInsensitiveCompare:nameOrBundleId] == NSOrderedSame) {
      return app; // An exact bundle id is unambiguous; take it immediately.
    }
    if ([localizedName caseInsensitiveCompare:nameOrBundleId] == NSOrderedSame) {
      [candidates insertObject:app atIndex:0];
    } else if (localizedLower.length && [localizedLower containsString:queryLower]) {
      [candidates addObject:app];
    } else if ([KnownEnglishNamesForBundleId(bundleId) containsObject:queryLower]) {
      // Well-known apps under a non-English system language.
      [candidates addObject:app];
    }
  }
  return candidates.firstObject;
}

/** English names for the system apps a caller is most likely to ask for by their English
 *  name on a system that reports a localized one. */
static NSArray<NSString *> *KnownEnglishNamesForBundleId(NSString *bundleId) {
  static NSDictionary<NSString *, NSArray<NSString *> *> *table = nil;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    table = @{
      @"com.apple.finder" : @[ @"finder" ],
      @"com.apple.Safari" : @[ @"safari" ],
      @"com.apple.systempreferences" : @[ @"system settings", @"system preferences" ],
      @"com.apple.Terminal" : @[ @"terminal" ],
      @"com.apple.mail" : @[ @"mail" ],
      @"com.apple.Photos" : @[ @"photos" ],
      @"com.apple.iCal" : @[ @"calendar" ],
      @"com.apple.Notes" : @[ @"notes" ],
      @"com.apple.Music" : @[ @"music" ],
      @"com.apple.ActivityMonitor" : @[ @"activity monitor" ],
      @"com.apple.TextEdit" : @[ @"textedit" ],
    };
  });
  return table[bundleId] ?: @[];
}

static NSDictionary *ApplicationSummary(NSRunningApplication *app) {
  return @{
    @"pid" : @(app.processIdentifier),
    @"bundleId" : app.bundleIdentifier ?: @"",
    @"name" : app.localizedName ?: @"",
    @"active" : @(app.isActive),
    @"hidden" : @(app.isHidden),
  };
}

/**
 * Bring an app forward.
 *
 * `activateWithOptions:` is the reason this helper never needs Apple Events: activation is an
 * AppKit call on a process we already have a handle on, not a script sent to another app.
 * That keeps the permission surface to Accessibility and Screen Recording alone.
 */
static BOOL ActivateApplication(NSRunningApplication *app) {
  if (!app) {
    return NO;
  }
  if (@available(macOS 14.0, *)) {
    return [app activateFromApplication:NSRunningApplication.currentApplication
                                 options:NSApplicationActivateAllWindows];
  }
  return [app activateWithOptions:NSApplicationActivateAllWindows];
}

#pragma mark - Synthetic input

static NSDictionary *KeyCodeForName(NSString *name) {
  static NSDictionary<NSString *, NSNumber *> *table = nil;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    table = @{
      @"return" : @36, @"enter" : @36, @"tab" : @48, @"space" : @49, @"escape" : @53,
      @"esc" : @53, @"delete" : @51, @"backspace" : @51, @"forwarddelete" : @117,
      @"up" : @126, @"down" : @125, @"left" : @123, @"right" : @124,
      @"home" : @115, @"end" : @119, @"pageup" : @116, @"pagedown" : @121,
      @"f1" : @122, @"f2" : @120, @"f3" : @99, @"f4" : @118, @"f5" : @96, @"f6" : @97,
      @"f7" : @98, @"f8" : @100, @"f9" : @101, @"f10" : @109, @"f11" : @103, @"f12" : @111,
      @"a" : @0, @"s" : @1, @"d" : @2, @"f" : @3, @"h" : @4, @"g" : @5, @"z" : @6,
      @"x" : @7, @"c" : @8, @"v" : @9, @"b" : @11, @"q" : @12, @"w" : @13, @"e" : @14,
      @"r" : @15, @"y" : @16, @"t" : @17, @"1" : @18, @"2" : @19, @"3" : @20, @"4" : @21,
      @"6" : @22, @"5" : @23, @"9" : @25, @"7" : @26, @"8" : @28, @"0" : @29,
      @"o" : @31, @"u" : @32, @"i" : @34, @"p" : @35, @"l" : @37, @"j" : @38, @"k" : @40,
      @"n" : @45, @"m" : @46, @"," : @43, @"." : @47, @"/" : @44, @";" : @41,
      @"'" : @39, @"[" : @33, @"]" : @30, @"\\" : @42, @"-" : @27, @"=" : @24,
      @"`" : @50,
    };
  });
  return @{@"code" : table[name.lowercaseString] ?: @(0),
           @"known" : @(table[name.lowercaseString] != nil)};
}

static CGEventFlags ModifierFlagsForName(NSString *name, BOOL *matched) {
  if ([name isEqualToString:@"cmd"] || [name isEqualToString:@"command"]) {
    *matched = YES;
    return kCGEventFlagMaskCommand;
  }
  if ([name isEqualToString:@"shift"]) {
    *matched = YES;
    return kCGEventFlagMaskShift;
  }
  if ([name isEqualToString:@"ctrl"] || [name isEqualToString:@"control"]) {
    *matched = YES;
    return kCGEventFlagMaskControl;
  }
  if ([name isEqualToString:@"alt"] || [name isEqualToString:@"opt"] || [name isEqualToString:@"option"]) {
    *matched = YES;
    return kCGEventFlagMaskAlternate;
  }
  return 0;
}

/** Press and release one key, with modifiers held for both halves. */
static void PostKeyChord(CGEventFlags flags, CGKeyCode code) {
  CGEventRef down = CGEventCreateKeyboardEvent(NULL, code, true);
  CGEventRef up = CGEventCreateKeyboardEvent(NULL, code, false);
  if (down && up) {
    CGEventSetFlags(down, flags);
    CGEventSetFlags(up, flags);
    CGEventPost(kCGHIDEventTap, down);
    CGEventPost(kCGHIDEventTap, up);
  }
  if (down) CFRelease(down);
  if (up) CFRelease(up);
}

enum { kKeyCodeReturn = 36, kKeyCodeTab = 48, kKeyCodeV = 9 };

/** Move the real pointer. Only the input paths that must land somewhere call this. */
static void MovePointerTo(CGPoint point) {
  CGEventRef move = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved, point, kCGMouseButtonLeft);
  if (move) {
    CGEventPost(kCGHIDEventTap, move);
    CFRelease(move);
  }
}

#pragma mark - Screen capture

/**
 * Capture through `/usr/sbin/screencapture`.
 *
 * The CoreGraphics capture call (`CGWindowListCreateImage`) is obsoleted in macOS 15 and the
 * SDK refuses to compile against it. ScreenCaptureKit is the sanctioned replacement, but it
 * is asynchronous, needs a stream per capture, and would run the app's own event loop just to
 * take a picture.
 *
 * `screencapture` is Apple's own tool for exactly this job, and running it as a child of this
 * helper is what makes it work: a child inherits its parent's privacy attribution, so it
 * captures under the helper's Screen Recording grant rather than needing one of its own. That
 * is the same attribution rule that makes the alternative — spawning this helper from the
 * host app — wrong.
 */
static BOOL RunScreencapture(NSArray<NSString *> *arguments, NSString *outputPath) {
  NSTask *task = [[NSTask alloc] init];
  task.executableURL = [NSURL fileURLWithPath:@"/usr/sbin/screencapture"];
  task.arguments = [arguments arrayByAddingObject:outputPath];
  task.standardOutput = [NSFileHandle fileHandleWithNullDevice];
  task.standardError = [NSFileHandle fileHandleWithNullDevice];

  NSError *error = nil;
  if (![task launchAndReturnError:&error]) {
    Log(@"could not run screencapture: %@", error.localizedDescription);
    return NO;
  }
  [task waitUntilExit];
  return task.terminationStatus == 0;
}

/** Pixel dimensions of a PNG on disk, or {0,0} when it cannot be read. */
static CGSize ImagePixelSize(NSString *path) {
  NSURL *url = [NSURL fileURLWithPath:path];
  CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
  if (!source) {
    return CGSizeZero;
  }
  CGSize size = CGSizeZero;
  CFDictionaryRef properties = CGImageSourceCopyPropertiesAtIndex(source, 0, NULL);
  if (properties) {
    CFNumberRef width = CFDictionaryGetValue(properties, kCGImagePropertyPixelWidth);
    CFNumberRef height = CFDictionaryGetValue(properties, kCGImagePropertyPixelHeight);
    double w = 0;
    double h = 0;
    if (width) {
      CFNumberGetValue(width, kCFNumberDoubleType, &w);
    }
    if (height) {
      CFNumberGetValue(height, kCFNumberDoubleType, &h);
    }
    size = CGSizeMake(w, h);
    CFRelease(properties);
  }
  CFRelease(source);
  return size;
}

/** The window id CoreGraphics knows a pid's frontmost window by.
 *
 *  Only the window *list* is used here — that API is still supported; it was the capture call
 *  built on top of it that was obsoleted. */
static CGWindowID FrontWindowIdForPid(pid_t pid) {
  CGWindowListOption options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
  CFArrayRef windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID);
  if (!windows) {
    return kCGNullWindowID;
  }

  CGWindowID found = kCGNullWindowID;
  double bestArea = 0;
  for (NSDictionary *info in (__bridge NSArray *)windows) {
    if ([info[(id)kCGWindowOwnerPID] intValue] != pid) {
      continue;
    }
    if ([info[(id)kCGWindowLayer] intValue] != 0) {
      continue;
    }
    CGRect bounds = CGRectZero;
    CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)info[(id)kCGWindowBounds], &bounds);
    double area = bounds.size.width * bounds.size.height;
    if (area > bestArea) {
      bestArea = area;
      found = (CGWindowID)[info[(id)kCGWindowNumber] unsignedIntValue];
    }
  }

  CFRelease(windows);
  return found;
}

#pragma mark - Display and window geometry

/**
 * Every active display, in the space that input synthesis and accessibility both use.
 *
 * That space is CoreGraphics': points, origin at the main display's top-left, y growing
 * downward. It is deliberately not Cocoa's (bottom-left origin) — mixing the two is how a click
 * ends up on the wrong screen — so everything here is read from CoreGraphics and never
 * converted.
 *
 * The scale factor is computed rather than asked for: pixels over points is exactly what a
 * caller needs to turn a point read off a screenshot back into a screen point, and it is
 * per-display. A retina laptop next to a 1x monitor has two different answers, and using the
 * main screen's for both is wrong by a factor of two on one of them.
 */
static NSArray<NSDictionary *> *CopyDisplaySummaries(void) {
  uint32_t count = 0;
  if (CGGetActiveDisplayList(0, NULL, &count) != kCGErrorSuccess || count == 0) {
    return @[];
  }
  enum { kMaxDisplays = 32 };
  CGDirectDisplayID displays[kMaxDisplays];
  uint32_t listed = MIN(count, (uint32_t)kMaxDisplays);
  if (CGGetActiveDisplayList(listed, displays, &listed) != kCGErrorSuccess) {
    return @[];
  }

  CGDirectDisplayID mainDisplay = CGMainDisplayID();
  NSMutableArray<NSDictionary *> *summaries = [NSMutableArray arrayWithCapacity:listed];
  for (uint32_t index = 0; index < listed; index++) {
    CGRect bounds = CGDisplayBounds(displays[index]);
    size_t pixelWidth = CGDisplayPixelsWide(displays[index]);
    size_t pixelHeight = CGDisplayPixelsHigh(displays[index]);
    double scale = bounds.size.width > 0 ? (double)pixelWidth / bounds.size.width : 1.0;

    [summaries addObject:@{
      @"id" : @(displays[index]),
      @"main" : (displays[index] == mainDisplay ? @YES : @NO),
      @"bounds" : @{
        @"x" : @(bounds.origin.x),
        @"y" : @(bounds.origin.y),
        @"width" : @(bounds.size.width),
        @"height" : @(bounds.size.height),
      },
      @"pixelWidth" : @(pixelWidth),
      @"pixelHeight" : @(pixelHeight),
      @"scaleFactor" : @(scale),
    }];
  }
  return summaries;
}

static CGRect BoundsFromSummary(NSDictionary *summary) {
  NSDictionary *bounds = summary[@"bounds"];
  return CGRectMake([bounds[@"x"] doubleValue], [bounds[@"y"] doubleValue],
                    [bounds[@"width"] doubleValue], [bounds[@"height"] doubleValue]);
}

/** The display a rect is mostly on, falling back to the one holding its centre. */
static NSDictionary *DisplayForRect(CGRect rect) {
  NSArray<NSDictionary *> *displays = CopyDisplaySummaries();
  NSDictionary *best = nil;
  double bestArea = 0;
  CGPoint centre = CGPointMake(CGRectGetMidX(rect), CGRectGetMidY(rect));

  for (NSDictionary *display in displays) {
    CGRect bounds = BoundsFromSummary(display);
    if (CGRectContainsPoint(bounds, centre)) {
      return display;
    }
    CGRect overlap = CGRectIntersection(bounds, rect);
    double area = CGRectIsNull(overlap) ? 0 : overlap.size.width * overlap.size.height;
    if (area > bestArea) {
      bestArea = area;
      best = display;
    }
  }

  for (NSDictionary *display in displays) {
    if ([display[@"main"] boolValue]) {
      return display;
    }
  }
  return best ?: displays.firstObject;
}

/** On-screen windows, largest first within each layer, as CoreGraphics describes them.
 *
 *  Layer 0 is where normal windows live; anything else is a panel, a menu or an overlay, and a
 *  caller that wants those has to ask. */
static NSArray<NSDictionary *> *CopyWindowSummaries(BOOL includeAllLayers) {
  CGWindowListOption options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
  CFArrayRef windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID);
  if (!windows) {
    return @[];
  }

  NSMutableArray<NSDictionary *> *summaries = [NSMutableArray array];
  for (NSDictionary *info in (__bridge NSArray *)windows) {
    NSInteger layer = [info[(id)kCGWindowLayer] integerValue];
    if (layer != 0 && !includeAllLayers) {
      continue;
    }
    CGRect bounds = CGRectZero;
    CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)info[(id)kCGWindowBounds],
                                           &bounds);
    if (bounds.size.width < 1 || bounds.size.height < 1) {
      continue;
    }

    [summaries addObject:@{
      @"windowId" : @([info[(id)kCGWindowNumber] unsignedIntValue]),
      @"pid" : @([info[(id)kCGWindowOwnerPID] intValue]),
      @"app" : info[(id)kCGWindowOwnerName] ?: @"",
      @"title" : info[(id)kCGWindowName] ?: @"",
      @"layer" : @(layer),
      @"bounds" : @{
        @"x" : @(bounds.origin.x),
        @"y" : @(bounds.origin.y),
        @"width" : @(bounds.size.width),
        @"height" : @(bounds.size.height),
      },
    }];
  }
  CFRelease(windows);

  // The front window per app is the largest normal one, which is the same rule the capture path
  // uses to pick a window — one definition, so the two cannot disagree.
  NSMutableDictionary<NSNumber *, NSNumber *> *frontByPid = [NSMutableDictionary dictionary];
  NSMutableDictionary<NSNumber *, NSNumber *> *bestAreaByPid = [NSMutableDictionary dictionary];
  for (NSDictionary *summary in summaries) {
    if ([summary[@"layer"] integerValue] != 0) {
      continue;
    }
    NSNumber *pid = summary[@"pid"];
    CGRect bounds = BoundsFromSummary(summary);
    double area = bounds.size.width * bounds.size.height;
    if (bestAreaByPid[pid] == nil || area > [bestAreaByPid[pid] doubleValue]) {
      bestAreaByPid[pid] = @(area);
      frontByPid[pid] = summary[@"windowId"];
    }
  }

  NSMutableArray<NSDictionary *> *annotated = [NSMutableArray arrayWithCapacity:summaries.count];
  for (NSDictionary *summary in summaries) {
    NSMutableDictionary *entry = [summary mutableCopy];
    entry[@"frontmost"] = ([frontByPid[summary[@"pid"]] isEqual:summary[@"windowId"]] ? @YES : @NO);
    [annotated addObject:entry];
  }
  return annotated;
}

/** The bounds of one window, or CGRectNull when it is not on screen. */
static CGRect BoundsForWindowId(CGWindowID windowId) {
  CGWindowListOption options = kCGWindowListOptionIncludingWindow;
  CFArrayRef windows = CGWindowListCopyWindowInfo(options, windowId);
  if (!windows) {
    return CGRectNull;
  }
  CGRect bounds = CGRectNull;
  for (NSDictionary *info in (__bridge NSArray *)windows) {
    if ([info[(id)kCGWindowNumber] unsignedIntegerValue] != windowId) {
      continue;
    }
    CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)info[(id)kCGWindowBounds],
                                           &bounds);
  }
  CFRelease(windows);
  return bounds;
}

#pragma mark - Clipboard

/**
 * The clipboard, as a first-class part of driving a GUI rather than a secret behind `type`.
 *
 * Reading it is how the agent gets at something a person would have copied; writing it is how it
 * hands text to an app that wants a file, a path or a block of text it can paste itself. Neither
 * needs a privacy grant of its own, and on recent macOS the *user* may still see the system's own
 * paste notification — that is Apple's gate, not something this helper can or should silence.
 */

static NSDictionary *HandleReadClipboard(void) {
  NSPasteboard *pasteboard = NSPasteboard.generalPasteboard;
  NSString *text = [pasteboard stringForType:NSPasteboardTypeString];

  return @{
    @"changeCount" : @(pasteboard.changeCount),
    @"itemCount" : @(pasteboard.pasteboardItems.count),
    @"types" : pasteboard.types ?: @[],
    @"hasText" : (text != nil ? @YES : @NO),
    @"text" : text ?: @"",
  };
}

static NSDictionary *HandleWriteClipboard(NSDictionary *params) {
  NSString *text = params[@"text"];
  if (![text isKindOfClass:NSString.class]) {
    return ResponseWithError(nil, @"bad_request", @"`text` is required.");
  }

  NSPasteboard *pasteboard = NSPasteboard.generalPasteboard;
  [pasteboard clearContents];
  if (![pasteboard setString:text forType:NSPasteboardTypeString]) {
    return ResponseWithError(nil, @"bad_request", @"The clipboard refused the text.");
  }

  return @{
    @"ok" : @YES,
    @"changeCount" : @(pasteboard.changeCount),
    @"detail" : [NSString stringWithFormat:@"wrote %lu characters to the clipboard",
                                           (unsigned long)text.length],
  };
}

/**
 * What is on the clipboard right now, as data per item.
 *
 * `NSPasteboardItem` is not copyable — `[item copy]` throws, and an uncaught exception in a
 * handler takes the whole helper down with it, which is how this was found. Reading the data out
 * cannot preserve an item whose bytes an app only hands over on demand (a file promise, say):
 * those read as nil and are dropped, which is the honest limit of putting someone's clipboard
 * back the way it was.
 */
static NSArray<NSDictionary *> *ClipboardSnapshot(void) {
  NSMutableArray<NSDictionary *> *items = [NSMutableArray array];
  for (NSPasteboardItem *item in NSPasteboard.generalPasteboard.pasteboardItems) {
    NSMutableDictionary<NSPasteboardType, NSData *> *entry = [NSMutableDictionary dictionary];
    for (NSPasteboardType type in item.types) {
      NSData *data = [item dataForType:type];
      if (data) {
        entry[type] = data;
      }
    }
    if (entry.count) {
      [items addObject:entry];
    }
  }
  return items;
}

static void ClipboardRestore(NSArray<NSDictionary *> *snapshot) {
  NSPasteboard *pasteboard = NSPasteboard.generalPasteboard;
  [pasteboard clearContents];
  if (!snapshot.count) {
    return;
  }

  NSMutableArray<NSPasteboardItem *> *items = [NSMutableArray array];
  for (NSDictionary<NSPasteboardType, NSData *> *entry in snapshot) {
    NSPasteboardItem *item = [[NSPasteboardItem alloc] init];
    for (NSPasteboardType type in entry) {
      [item setData:entry[type] forType:type];
    }
    [items addObject:item];
  }
  [pasteboard writeObjects:items];
}

/** Put `text` on the clipboard, and hand back what was there so it can be put back. */
static NSArray<NSDictionary *> *ClipboardReplaceWithText(NSString *text) {
  NSArray<NSDictionary *> *snapshot = ClipboardSnapshot();
  NSPasteboard *pasteboard = NSPasteboard.generalPasteboard;
  [pasteboard clearContents];
  [pasteboard setString:text forType:NSPasteboardTypeString];
  return snapshot;
}

/**
 * Type by putting the text on the clipboard and pressing ⌘V.
 *
 * This is the fast and reliable path for long text and for anything an input method would
 * otherwise reinterpret — the per-character path posts a unicode key event for every character,
 * which some apps process slowly and a few mangle. It costs a clipboard round trip, so the
 * user's own clipboard is saved and put back; the wait before the restore is what gives the
 * target time to read it, and an app that reads the pasteboard lazily (on save, say) can still
 * miss it. `keys` is the default for that reason.
 */
static NSDictionary *TypeByPaste(NSString *text) {
  NSArray<NSDictionary *> *saved = ClipboardReplaceWithText(text);
  PostKeyChord(kCGEventFlagMaskCommand, (CGKeyCode)kKeyCodeV);
  [NSThread sleepForTimeInterval:0.25];
  ClipboardRestore(saved);

  return @{
    @"ok" : @YES,
    @"strategy" : @"paste",
    @"detail" : [NSString stringWithFormat:@"typed %lu characters by pasting", (unsigned long)text.length],
  };
}

#pragma mark - Request handlers

static NSDictionary *HandleStatus(NSDictionary *params) {
  return @{
    @"protocolVersion" : @(kProtocolVersion),
    @"helperVersion" : @(kHelperVersion),
    @"accessibility" : @(AccessibilityGranted()),
    @"screenRecording" : @(ScreenRecordingGranted()),
    @"bundleId" : NSBundle.mainBundle.bundleIdentifier ?: @"",
    @"helperPath" : NSBundle.mainBundle.bundlePath ?: @"",
    @"processId" : @(NSProcessInfo.processInfo.processIdentifier),
  };
}

static NSDictionary *HandleRequestAccess(NSDictionary *params) {
  // Both calls are written to show the system prompt when the grant is missing and to do
  // nothing when it is present, so calling this twice is harmless.
  if (!AccessibilityGranted()) {
    NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt : @YES};
    AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
  }
  if (!ScreenRecordingGranted()) {
    CGRequestScreenCaptureAccess();
  }
  return HandleStatus(params);
}

static NSDictionary *HandleListApps(NSDictionary *params) {
  NSMutableArray *apps = [NSMutableArray array];
  for (NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications) {
    if (app.activationPolicy == NSApplicationActivationPolicyProhibited) {
      continue;
    }
    [apps addObject:ApplicationSummary(app)];
  }
  [apps sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
    return [a[@"name"] caseInsensitiveCompare:b[@"name"]];
  }];
  return @{@"apps" : apps};
}

/**
 * Which windows to walk.
 *
 * Defaulting to every window of an app produces an enormous dump for anything with several
 * windows open — Finder alone reaches the node ceiling — and most of it is not what anyone
 * asked about. The window the user is actually looking at is the useful default; `all` exists
 * for the case where the model needs to find something it was not told the location of.
 */
static NSArray *CopyRootWindows(AXUIElementRef appElement, NSDictionary *params) {
  NSString *scope = [params[@"scope"] isKindOfClass:NSString.class] ? params[@"scope"] : @"";
  BOOL wantsAllWindows = [scope isEqualToString:@"all"];

  if (!wantsAllWindows) {
    for (NSString *attribute in @[ @"AXFocusedWindow", @"AXMainWindow" ]) {
      CFTypeRef window = NULL;
      if (AXUIElementCopyAttributeValue(appElement, (__bridge CFStringRef)attribute, &window) ==
              kAXErrorSuccess &&
          window) {
        if (CFGetTypeID(window) == AXUIElementGetTypeID()) {
          NSArray *roots = @[ (__bridge id)window ];
          CFRelease(window);
          return roots;
        }
        CFRelease(window);
      }
    }
  }

  return CopyChildren(appElement, @"AXApplication");
}

static NSDictionary *HandleGetState(NSDictionary *params, NSString *directory) {
  if (!AccessibilityGranted()) {
    return ResponseWithError(nil, @"accessibility_denied",
                             @"Peak Code Computer Use does not have Accessibility permission.");
  }

  NSNumber *pidNumber = params[@"pid"];
  NSString *appName = params[@"app"];
  pid_t pid = pidNumber ? (pid_t)pidNumber.intValue : 0;

  NSRunningApplication *app = FindApplication(appName ?: @"", pid);
  if (!app) {
    return ResponseWithError(nil, @"bad_request",
                             appName.length ? [NSString stringWithFormat:@"No running app matches \"%@\".", appName]
                                            : @"Pass either `pid` or `app`.");
  }

  AXUIElementRef appElement = AXUIElementCreateApplication(app.processIdentifier);
  if (!appElement) {
    return ResponseWithError(nil, @"bad_request", @"Could not attach to that app.");
  }

  // Every attribute read is a synchronous round trip into the target app. Without a timeout,
  // an app that is busy — or showing a modal, or wedged — turns one call into a multi-second
  // stall per attribute, and the caller waits for the whole walk. Bounding it per call keeps
  // the failure proportional: a slow app yields a partial tree instead of a hung socket.
  AXUIElementSetMessagingTimeout(appElement, kMessagingTimeoutSeconds);
  Log(@"get_state: attached to %@ (pid %d)", app.localizedName ?: @"app", app.processIdentifier);

  NSMutableString *out = [NSMutableString string];
  NSMutableArray *collected = [NSMutableArray array];
  BOOL timedOut = NO;

  // Walk once, and if the app published almost nothing, ask it to build a real tree and walk
  // again. The second walk is what turns "four unnamed nodes, use coordinates" into a usable
  // element list for apps that hide their tree until someone asks.
  for (NSInteger attempt = 0; attempt < 2; attempt++) {
    [out setString:@""];
    [collected removeAllObjects];
    timedOut = NO;

    NSTimeInterval attemptStarted = NSDate.date.timeIntervalSince1970;
    NSTimeInterval deadline = attemptStarted + kWalkDeadlineSeconds;
    NSArray *roots = CopyRootWindows(appElement, params);
    Log(@"get_state: attempt %ld, %lu root windows (%.2fs to read them)", (long)attempt,
        (unsigned long)roots.count, NSDate.date.timeIntervalSince1970 - attemptStarted);

    for (id window in roots) {
      if (collected.count >= (NSUInteger)kMaxNodes || timedOut) {
        break;
      }
      WalkElement((__bridge AXUIElementRef)window, 0, out, collected, deadline, &timedOut);
    }
    Log(@"get_state: attempt %ld done, %lu elements in %.2fs (timedOut=%d)", (long)attempt,
        (unsigned long)collected.count, NSDate.date.timeIntervalSince1970 - attemptStarted, timedOut);

    if (collected.count >= kSparseTreeThreshold || attempt == 1) {
      break;
    }
    RequestManualAccessibility(appElement);
    [NSThread sleepForTimeInterval:0.25];
  }

  StoreObservation(collected);

  NSMutableString *header = [NSMutableString
      stringWithFormat:@"%@ (pid %d) — %ld elements\n", app.localizedName ?: @"app",
                       app.processIdentifier, (long)collected.count];
  [out insertString:header atIndex:0];

  if (timedOut) {
    // Said plainly, because a partial tree looks like a complete one otherwise, and the model
    // would conclude a control does not exist when it simply was not reached in time.
    [out appendFormat:@"\n[stopped early after %.0fs — this app stopped answering accessibility; "
                      @"the tree above is partial]\n",
                      kWalkDeadlineSeconds];
  } else if (collected.count >= (NSUInteger)kMaxNodes) {
    [out appendFormat:@"\n[truncated at %ld elements]\n", (long)kMaxNodes];
  }

  return @{
    @"stateId" : gStateId ?: @"",
    @"app" : ApplicationSummary(app),
    @"text" : out,
    @"elementCount" : @(collected.count),
    // Explicit, because `@(expression)` boxes a plain int for anything that is not a BOOL-
    // typed call: `partial` went out as 1, and every reader that checked for `true` saw a
    // complete tree.
    @"partial" : ((timedOut || collected.count >= (NSUInteger)kMaxNodes) ? @YES : @NO),
    @"scannedAt" : @(NSDate.date.timeIntervalSince1970),
  };
}

static NSDictionary *HandleAct(NSDictionary *params, NSString *directory) {
  if (!AccessibilityGranted()) {
    return ResponseWithError(nil, @"accessibility_denied",
                             @"Peak Code Computer Use does not have Accessibility permission.");
  }

  NSString *stateId = params[@"stateId"];
  NSString *action = params[@"action"] ?: @"press";
  NSNumber *refNumber = params[@"ref"];

  if (!stateId.length || ![stateId isEqualToString:gStateId ?: @""]) {
    return ResponseWithError(nil, @"stale_ref",
                             @"That ref belongs to an older observation. Call get_state again.");
  }
  if (!refNumber) {
    return ResponseWithError(nil, @"bad_request", @"`ref` is required.");
  }

  AXUIElementRef element = ElementForRef(refNumber.integerValue);
  if (!element) {
    return ResponseWithError(nil, @"stale_ref",
                             @"That ref is not in the current observation. Call get_state again.");
  }

  if ([action isEqualToString:@"press"]) {
    AXError error = AXUIElementPerformAction(element, kAXPressAction);
    if (error != kAXErrorSuccess) {
      return ResponseWithError(nil, @"bad_request",
                               [NSString stringWithFormat:@"AXPress failed (%d). The element may be disabled.",
                                                          (int)error]);
    }
    return @{@"ok" : @YES, @"detail" : @"pressed"};
  }

  if ([action isEqualToString:@"raise"]) {
    AXError error = AXUIElementPerformAction(element, kAXRaiseAction);
    if (error != kAXErrorSuccess) {
      return ResponseWithError(nil, @"bad_request",
                               [NSString stringWithFormat:@"AXRaise failed (%d).", (int)error]);
    }
    return @{@"ok" : @YES, @"detail" : @"raised"};
  }

  if ([action isEqualToString:@"focus"]) {
    AXError error = AXUIElementSetAttributeValue(element, kAXFocusedAttribute, kCFBooleanTrue);
    if (error != kAXErrorSuccess) {
      return ResponseWithError(nil, @"bad_request",
                               [NSString stringWithFormat:@"Focus failed (%d).", (int)error]);
    }
    return @{@"ok" : @YES, @"detail" : @"focused"};
  }

  if ([action isEqualToString:@"set_value"]) {
    NSString *value = params[@"value"];
    if (value == nil) {
      return ResponseWithError(nil, @"bad_request", @"`set_value` needs a `value`.");
    }
    // This is the background-safe way to put text in a field: it writes the attribute
    // directly instead of typing, so it works without focus and without moving the pointer.
    AXError error = AXUIElementSetAttributeValue(element, kAXValueAttribute, (__bridge CFStringRef)value);
    if (error != kAXErrorSuccess) {
      return ResponseWithError(
          nil, @"bad_request",
          [NSString stringWithFormat:@"Setting the value failed (%d). Use `type` for controls that "
                                     @"do not accept a value.",
                                     (int)error]);
    }
    return @{@"ok" : @YES, @"detail" : @"value set"};
  }

  return ResponseWithError(nil, @"bad_request",
                           [NSString stringWithFormat:@"Unknown action \"%@\".", action]);
}

static NSDictionary *HandleOpenApp(NSDictionary *params) {
  NSString *nameOrBundleId = params[@"app"];
  NSString *path = params[@"path"];
  pid_t pid = params[@"pid"] ? (pid_t)[params[@"pid"] intValue] : 0;

  NSRunningApplication *app = FindApplication(nameOrBundleId ?: @"", pid);

  if (!app && path.length) {
    // A path is the one way to start something that is not running yet.
    NSURL *url = [NSURL fileURLWithPath:path];
    NSWorkspaceOpenConfiguration *configuration = [NSWorkspaceOpenConfiguration configuration];
    [NSWorkspace.sharedWorkspace openApplicationAtURL:url
                                        configuration:configuration
                                    completionHandler:^(NSRunningApplication *launched, NSError *error){
                                    }];
    return @{@"ok" : @YES, @"detail" : [NSString stringWithFormat:@"launched %@", path]};
  }

  if (!app) {
    return ResponseWithError(
        nil, @"bad_request",
        nameOrBundleId.length
            ? [NSString stringWithFormat:@"No running app matches \"%@\". Pass `path` to launch one.",
                                         nameOrBundleId]
            : @"Pass `app`, `pid` or `path`.");
  }

  BOOL activated = ActivateApplication(app);
  return @{@"ok" : @(activated),
           @"detail" : activated ? @"activated" : @"found but could not activate",
           @"app" : ApplicationSummary(app)};
}

static NSDictionary *HandleClick(NSDictionary *params, NSString *directory) {
  if (!AccessibilityGranted()) {
    return ResponseWithError(nil, @"accessibility_denied",
                             @"Peak Code Computer Use does not have Accessibility permission.");
  }

  NSNumber *x = params[@"x"];
  NSNumber *y = params[@"y"];
  if (!x || !y) {
    return ResponseWithError(nil, @"bad_request", @"`x` and `y` are required (global screen points).");
  }

  NSString *button = params[@"button"] ?: @"left";
  NSInteger count = params[@"count"] ? [params[@"count"] integerValue] : 1;
  CGPoint point = CGPointMake(x.doubleValue, y.doubleValue);

  CGEventType downType = kCGEventLeftMouseDown;
  CGEventType upType = kCGEventLeftMouseUp;
  CGMouseButton cgButton = kCGMouseButtonLeft;
  if ([button isEqualToString:@"right"]) {
    downType = kCGEventRightMouseDown;
    upType = kCGEventRightMouseUp;
    cgButton = kCGMouseButtonRight;
  } else if ([button isEqualToString:@"middle"]) {
    downType = kCGEventOtherMouseDown;
    upType = kCGEventOtherMouseUp;
    cgButton = kCGMouseButtonCenter;
  }

  for (NSInteger click = 1; click <= MAX(count, 1); click++) {
    MovePointerTo(point);
    CGEventRef down = CGEventCreateMouseEvent(NULL, downType, point, cgButton);
    CGEventRef up = CGEventCreateMouseEvent(NULL, upType, point, cgButton);
    if (down && up) {
      // The click state is what turns two clicks into a double-click; without it the app
      // sees two independent single clicks.
      CGEventSetIntegerValueField(down, kCGMouseEventClickState, click);
      CGEventSetIntegerValueField(up, kCGMouseEventClickState, click);
      CGEventPost(kCGHIDEventTap, down);
      CGEventPost(kCGHIDEventTap, up);
    }
    if (down) CFRelease(down);
    if (up) CFRelease(up);
    if (click < count) {
      [NSThread sleepForTimeInterval:0.05];
    }
  }

  return @{@"ok" : @YES,
           @"detail" : [NSString stringWithFormat:@"%@ click x%ld at (%.0f,%.0f)", button, (long)count,
                                                  point.x, point.y]};
}

static NSDictionary *HandleType(NSDictionary *params, NSString *directory) {
  if (!AccessibilityGranted()) {
    return ResponseWithError(nil, @"accessibility_denied",
                             @"Peak Code Computer Use does not have Accessibility permission.");
  }

  NSString *text = params[@"text"];
  if (![text isKindOfClass:NSString.class]) {
    return ResponseWithError(nil, @"bad_request", @"`text` is required.");
  }

  NSString *strategy = [params[@"strategy"] isKindOfClass:NSString.class]
                           ? [params[@"strategy"] lowercaseString]
                           : @"keys";
  if ([strategy isEqualToString:@"paste"]) {
    return TypeByPaste(text);
  }
  if (![strategy isEqualToString:@"keys"]) {
    return ResponseWithError(nil, @"bad_request",
                             [NSString stringWithFormat:@"Unknown `strategy` \"%@\". Use keys or paste.",
                                                        strategy]);
  }

  for (NSUInteger index = 0; index < text.length; index++) {
    unichar character = [text characterAtIndex:index];
    // Newline and tab are not characters a keyboard event can carry as text; they have to go
    // as the keys that produce them.
    if (character == '\n') {
      PostKeyChord(0, (CGKeyCode)kKeyCodeReturn);
      continue;
    }
    if (character == '\t') {
      PostKeyChord(0, (CGKeyCode)kKeyCodeTab);
      continue;
    }

    // Surrogate pairs have to be posted together or the character is mangled.
    UniChar pair[2] = {character, 0};
    NSUInteger length = 1;
    if (CFStringIsSurrogateHighCharacter(character) && index + 1 < text.length) {
      pair[1] = [text characterAtIndex:index + 1];
      length = 2;
      index += 1;
    }

    CGEventRef down = CGEventCreateKeyboardEvent(NULL, 0, true);
    CGEventRef up = CGEventCreateKeyboardEvent(NULL, 0, false);
    if (down && up) {
      CGEventKeyboardSetUnicodeString(down, (UniCharCount)length, pair);
      CGEventKeyboardSetUnicodeString(up, (UniCharCount)length, pair);
      CGEventPost(kCGHIDEventTap, down);
      CGEventPost(kCGHIDEventTap, up);
    }
    if (down) CFRelease(down);
    if (up) CFRelease(up);
  }

  return @{@"ok" : @YES, @"detail" : [NSString stringWithFormat:@"typed %lu characters", (unsigned long)text.length]};
}

static NSDictionary *HandleKey(NSDictionary *params, NSString *directory) {
  if (!AccessibilityGranted()) {
    return ResponseWithError(nil, @"accessibility_denied",
                             @"Peak Code Computer Use does not have Accessibility permission.");
  }

  NSString *chord = params[@"key"];
  if (![chord isKindOfClass:NSString.class] || !chord.length) {
    return ResponseWithError(nil, @"bad_request", @"`key` is required, for example `Enter` or `cmd+a`.");
  }

  NSArray<NSString *> *parts = [chord componentsSeparatedByString:@"+"];
  CGEventFlags flags = 0;
  NSString *keyName = nil;
  for (NSString *rawPart in parts) {
    NSString *part = [rawPart stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    BOOL matched = NO;
    CGEventFlags flag = ModifierFlagsForName(part, &matched);
    if (matched) {
      flags |= flag;
    } else {
      keyName = part;
    }
  }

  if (!keyName.length) {
    return ResponseWithError(nil, @"bad_request", @"A chord needs a non-modifier key, for example `cmd+a`.");
  }

  NSDictionary *resolved = KeyCodeForName(keyName);
  if (![resolved[@"known"] boolValue]) {
    return ResponseWithError(nil, @"bad_request",
                             [NSString stringWithFormat:@"Unknown key \"%@\".", keyName]);
  }

  CGKeyCode code = (CGKeyCode)[resolved[@"code"] unsignedShortValue];
  PostKeyChord(flags, code);

  return @{@"ok" : @YES, @"detail" : [NSString stringWithFormat:@"pressed %@", chord]};
}

/**
 * Where a synthetic event should land.
 *
 * An explicit point wins; otherwise an app's front window, since "scroll this window" is what a
 * caller means when they name an app and no coordinates. Nothing resolved means the event goes
 * wherever the pointer already is, which is a legitimate answer for scroll and not for drag.
 */
static BOOL ResolveTargetPoint(NSDictionary *params, CGPoint *out) {
  NSNumber *x = params[@"x"];
  NSNumber *y = params[@"y"];
  if ([x isKindOfClass:NSNumber.class] && [y isKindOfClass:NSNumber.class]) {
    *out = CGPointMake(x.doubleValue, y.doubleValue);
    return YES;
  }

  pid_t pid = params[@"pid"] ? (pid_t)[params[@"pid"] intValue] : 0;
  if (!pid && [params[@"app"] isKindOfClass:NSString.class]) {
    NSRunningApplication *app = FindApplication(params[@"app"], 0);
    pid = app.processIdentifier;
  }
  if (pid > 0) {
    CGRect bounds = BoundsForWindowId(FrontWindowIdForPid(pid));
    if (!CGRectIsNull(bounds) && bounds.size.width >= 1 && bounds.size.height >= 1) {
      *out = CGPointMake(CGRectGetMidX(bounds), CGRectGetMidY(bounds));
      return YES;
    }
  }
  return NO;
}

static NSDictionary *HandleScroll(NSDictionary *params, NSString *directory) {
  if (!AccessibilityGranted()) {
    return ResponseWithError(nil, @"accessibility_denied",
                             @"Peak Code Computer Use does not have Accessibility permission.");
  }

  NSString *direction = [params[@"direction"] isKindOfClass:NSString.class]
                            ? [params[@"direction"] lowercaseString]
                            : @"";
  NSString *unit = [params[@"unit"] isKindOfClass:NSString.class]
                       ? [params[@"unit"] lowercaseString]
                       : @"line";
  BOOL pixels = [unit isEqualToString:@"pixel"];
  if (!pixels && ![unit isEqualToString:@"line"]) {
    return ResponseWithError(nil, @"bad_request", @"`unit` is `line` or `pixel`.");
  }

  double requested = params[@"amount"] ? [params[@"amount"] doubleValue] : 0;
  double amount = requested > 0 ? requested : (pixels ? 240.0 : 3.0);
  amount = MIN(amount, pixels ? 4000.0 : 100.0);

  // Positive CoreGraphics wheel values scroll up and to the left: they reveal what is above and
  // before. A caller says "down" meaning "show me what is further down", so the sign flips.
  int32_t vertical = 0;
  int32_t horizontal = 0;
  if ([direction isEqualToString:@"up"]) {
    vertical = 1;
  } else if ([direction isEqualToString:@"down"]) {
    vertical = -1;
  } else if ([direction isEqualToString:@"left"]) {
    horizontal = 1;
  } else if ([direction isEqualToString:@"right"]) {
    horizontal = -1;
  } else {
    return ResponseWithError(nil, @"bad_request",
                             @"`direction` is up, down, left or right.");
  }

  CGPoint target = CGPointZero;
  BOOL haveTarget = ResolveTargetPoint(params, &target);
  if (haveTarget) {
    // Scroll events are routed by where the pointer is, not by where the event says it is, so
    // the pointer has to move first for the scroll to land in the window the caller named.
    MovePointerTo(target);
    [NSThread sleepForTimeInterval:0.05];
  }

  // One big event is treated as a jump by some apps and ignored by others; a handful of small
  // ones is what a wheel or trackpad actually produces.
  NSInteger steps = (NSInteger)ceil(amount / (pixels ? 40.0 : 1.0));
  steps = MIN(MAX(steps, 1), 20);
  int32_t stepVertical = (int32_t)llround(vertical * amount / steps);
  int32_t stepHorizontal = (int32_t)llround(horizontal * amount / steps);
  CGScrollEventUnit scrollUnit = pixels ? kCGScrollEventUnitPixel : kCGScrollEventUnitLine;

  for (NSInteger step = 0; step < steps; step++) {
    CGEventRef event = CGEventCreateScrollWheelEvent(NULL, scrollUnit, 2, stepVertical,
                                                     stepHorizontal);
    if (event) {
      if (haveTarget) {
        CGEventSetLocation(event, target);
      }
      CGEventPost(kCGHIDEventTap, event);
      CFRelease(event);
    }
    if (step + 1 < steps) {
      [NSThread sleepForTimeInterval:pixels ? 0.01 : 0.015];
    }
  }

  return @{
    @"ok" : @YES,
    @"pointerMoved" : (haveTarget ? @YES : @NO),
    @"detail" : [NSString stringWithFormat:@"scrolled %@ by %.0f %@%@", direction, amount,
                                           pixels ? @"pixels" : @"lines",
                                           haveTarget ? @" (pointer moved first)" : @""],
  };
}

static NSDictionary *HandleDrag(NSDictionary *params, NSString *directory) {
  if (!AccessibilityGranted()) {
    return ResponseWithError(nil, @"accessibility_denied",
                             @"Peak Code Computer Use does not have Accessibility permission.");
  }

  NSNumber *fromX = params[@"from_x"];
  NSNumber *fromY = params[@"from_y"];
  NSNumber *toX = params[@"to_x"];
  NSNumber *toY = params[@"to_y"];
  if (![fromX isKindOfClass:NSNumber.class] || ![fromY isKindOfClass:NSNumber.class] ||
      ![toX isKindOfClass:NSNumber.class] || ![toY isKindOfClass:NSNumber.class]) {
    return ResponseWithError(nil, @"bad_request",
                             @"`from_x`, `from_y`, `to_x` and `to_y` are required (global screen points).");
  }

  NSString *button = params[@"button"] ?: @"left";
  CGEventType downType = kCGEventLeftMouseDown;
  CGEventType dragType = kCGEventLeftMouseDragged;
  CGEventType upType = kCGEventLeftMouseUp;
  CGMouseButton cgButton = kCGMouseButtonLeft;
  if ([button isEqualToString:@"right"]) {
    downType = kCGEventRightMouseDown;
    dragType = kCGEventRightMouseDragged;
    upType = kCGEventRightMouseUp;
    cgButton = kCGMouseButtonRight;
  } else if ([button isEqualToString:@"middle"]) {
    downType = kCGEventOtherMouseDown;
    dragType = kCGEventOtherMouseDragged;
    upType = kCGEventOtherMouseUp;
    cgButton = kCGMouseButtonCenter;
  }

  CGEventFlags flags = 0;
  if ([params[@"modifiers"] isKindOfClass:NSString.class]) {
    for (NSString *part in [params[@"modifiers"] componentsSeparatedByString:@"+"]) {
      BOOL matched = NO;
      CGEventFlags flag =
          ModifierFlagsForName([part stringByTrimmingCharactersInSet:
                                         NSCharacterSet.whitespaceCharacterSet],
                               &matched);
      if (matched) {
        flags |= flag;
      }
    }
  }

  double durationMs = params[@"duration_ms"] ? [params[@"duration_ms"] doubleValue] : 400.0;
  durationMs = MIN(MAX(durationMs, 50.0), 5000.0);
  NSInteger steps = (NSInteger)llround(durationMs / 16.0);
  steps = MIN(MAX(steps, 8), 120);

  CGPoint from = CGPointMake(fromX.doubleValue, fromY.doubleValue);
  CGPoint to = CGPointMake(toX.doubleValue, toY.doubleValue);

  MovePointerTo(from);
  [NSThread sleepForTimeInterval:0.05];

  CGEventRef down = CGEventCreateMouseEvent(NULL, downType, from, cgButton);
  if (down) {
    CGEventSetFlags(down, flags);
    CGEventSetIntegerValueField(down, kCGMouseEventClickState, 1);
    CGEventPost(kCGHIDEventTap, down);
    CFRelease(down);
  }

  // The intermediate moves are what separate a drag from a click-and-jump: apps that track a
  // gesture (a slider, a reorder, a selection) need the path, not just the endpoints.
  for (NSInteger step = 1; step <= steps; step++) {
    double progress = (double)step / (double)steps;
    CGPoint point = CGPointMake(from.x + (to.x - from.x) * progress,
                               from.y + (to.y - from.y) * progress);
    CGEventRef moved = CGEventCreateMouseEvent(NULL, dragType, point, cgButton);
    if (moved) {
      CGEventSetFlags(moved, flags);
      CGEventPost(kCGHIDEventTap, moved);
      CFRelease(moved);
    }
    [NSThread sleepForTimeInterval:(durationMs / 1000.0) / (double)steps];
  }

  CGEventRef up = CGEventCreateMouseEvent(NULL, upType, to, cgButton);
  if (up) {
    CGEventSetFlags(up, flags);
    CGEventSetIntegerValueField(up, kCGMouseEventClickState, 1);
    CGEventPost(kCGHIDEventTap, up);
    CFRelease(up);
  }

  return @{
    @"ok" : @YES,
    @"detail" : [NSString stringWithFormat:@"dragged %@ from (%.0f,%.0f) to (%.0f,%.0f) in %ld steps",
                                           button, from.x, from.y, to.x, to.y, (long)steps],
  };
}

static NSDictionary *HandleListWindows(NSDictionary *params) {
  BOOL includeAllLayers = [params[@"include_all_layers"] boolValue];
  NSArray<NSDictionary *> *windows = CopyWindowSummaries(includeAllLayers);

  return @{
    @"windows" : windows,
    @"windowCount" : @(windows.count),
    @"displays" : CopyDisplaySummaries(),
  };
}

static NSDictionary *HandleDisplays(void) {
  NSArray<NSDictionary *> *displays = CopyDisplaySummaries();
  return @{@"displays" : displays, @"displayCount" : @(displays.count)};
}

static NSDictionary *HandleScreenshot(NSDictionary *params, NSString *directory) {
  if (!ScreenRecordingGranted()) {
    return ResponseWithError(
        nil, @"screen_recording_denied",
        @"Peak Code Computer Use does not have Screen Recording permission.");
  }

  pid_t pid = params[@"pid"] ? (pid_t)[params[@"pid"] intValue] : 0;
  if (!pid && [params[@"app"] isKindOfClass:NSString.class]) {
    NSRunningApplication *app = FindApplication(params[@"app"], 0);
    if (!app) {
      return ResponseWithError(nil, @"bad_request", @"No running app matches that name.");
    }
    pid = app.processIdentifier;
  }

  CGWindowID requestedWindow = params[@"window_id"] ? (CGWindowID)[params[@"window_id"] unsignedIntValue]
                                                    : kCGNullWindowID;
  NSString *shotsDir = [directory stringByAppendingPathComponent:@"shots"];
  [NSFileManager.defaultManager createDirectoryAtPath:shotsDir
                          withIntermediateDirectories:YES
                                           attributes:nil
                                                error:nil];
  NSString *path = [shotsDir
      stringByAppendingPathComponent:[NSString
                                         stringWithFormat:@"shot-%lld.png",
                                                          (long long)(NSDate.date.timeIntervalSince1970 * 1000)]];

  NSMutableArray<NSString *> *arguments = [@[ @"-x", @"-t", @"png" ] mutableCopy];
  CGWindowID capturedWindow = requestedWindow;
  if (capturedWindow == kCGNullWindowID && pid > 0) {
    capturedWindow = FrontWindowIdForPid(pid);
    if (capturedWindow == kCGNullWindowID) {
      return ResponseWithError(nil, @"bad_request", @"That app has no on-screen window to capture.");
    }
  }

  // Where the captured region sits in screen points. The image starts at this point, and a
  // caller turning a pixel in it back into a screen coordinate needs both this and the scale —
  // a window whose origin is (43,88) is not at the screen's origin, and assuming it is puts
  // every click off by that much.
  CGRect capturedBounds = CGRectNull;
  if (capturedWindow != kCGNullWindowID) {
    capturedBounds = BoundsForWindowId(capturedWindow);
    if (CGRectIsNull(capturedBounds)) {
      return ResponseWithError(nil, @"bad_request", @"That window is not on screen.");
    }
    // -o drops the window shadow, so the image is the window and nothing else.
    [arguments addObjectsFromArray:@[ @"-o", @"-l", [NSString stringWithFormat:@"%u", capturedWindow] ]];
  }

  if (!RunScreencapture(arguments, path)) {
    return ResponseWithError(
        nil, @"screen_recording_denied",
        @"The capture failed. Screen Recording may have been revoked, or the display is locked.");
  }

  CGSize pixels = ImagePixelSize(path);
  if (pixels.width <= 0 || pixels.height <= 0) {
    return ResponseWithError(nil, @"bad_request", @"The capture produced an unreadable image.");
  }

  // CoreGraphics and screencapture report pixels; input synthesis and accessibility geometry
  // are both in points. The ratio is per display — a retina laptop beside a 1x monitor has two
  // different answers — so it is taken from the display the captured content is on, and reported
  // rather than assumed.
  NSDictionary *display = DisplayForRect(CGRectIsNull(capturedBounds)
                                             ? CGRectMake(0, 0, 1, 1)
                                             : capturedBounds);
  if (pixels.width > 0 && !CGRectIsNull(capturedBounds)) {
    // A capture of a window can come back at a different scale than the display suggests (an app
    // that renders at 1x on a retina screen); the image is the truth, so the ratio is recomputed
    // from it when the two disagree.
    double derived = pixels.width / MAX(capturedBounds.size.width, 1.0);
    if (fabs(derived - [display[@"scaleFactor"] doubleValue]) > 0.01) {
      Log(@"capture scale %.2f differs from display scale %.2f for window %u", derived,
          [display[@"scaleFactor"] doubleValue], capturedWindow);
      display = @{
        @"id" : display[@"id"] ?: @0,
        @"main" : display[@"main"] ?: @NO,
        @"bounds" : display[@"bounds"] ?: @{},
        @"scaleFactor" : @(derived),
      };
    }
  }
  CGFloat scale = [display[@"scaleFactor"] doubleValue] > 0 ? [display[@"scaleFactor"] doubleValue] : 1.0;
  CGPoint origin = CGRectIsNull(capturedBounds) ? CGPointZero : capturedBounds.origin;

  NSMutableDictionary *result = [@{
    @"path" : path,
    @"pixelWidth" : @(pixels.width),
    @"pixelHeight" : @(pixels.height),
    @"pointWidth" : @(pixels.width / scale),
    @"pointHeight" : @(pixels.height / scale),
    @"scaleFactor" : @(scale),
    @"originX" : @(origin.x),
    @"originY" : @(origin.y),
    @"display" : display,
  } mutableCopy];
  if (capturedWindow != kCGNullWindowID) {
    result[@"windowId"] = @(capturedWindow);
  }
  return result;
}

#pragma mark - Dispatch

static NSDictionary *DispatchUnprotected(NSDictionary *request, NSString *directory,
                                        NSString *token);

/**
 * Dispatch one request, and turn a handler's own bug into an answer.
 *
 * An Objective-C exception that escapes a handler terminates the process — measured: a
 * `[NSPasteboardItem copy]` that threw took the helper down, so the client that made the call got
 * a closed socket and every *other* client lost the helper too. Handlers read whatever a peer
 * sent, so this is a bug that has to be visible rather than fatal: the caller gets `internal_error`
 * naming what happened, the log keeps the detail, and the helper keeps serving.
 */
static NSDictionary *Dispatch(NSDictionary *request, NSString *directory, NSString *token) {
  @try {
    return DispatchUnprotected(request, directory, token);
  } @catch (NSException *exception) {
    NSString *detail = [NSString stringWithFormat:@"%@: %@", exception.name ?: @"exception",
                                                  exception.reason ?: @"no reason given"];
    Log(@"method \"%@\" raised %@", request[@"method"] ?: @"?", detail);
    return ResponseWithError(request[@"id"], @"internal_error",
                             [NSString stringWithFormat:@"The computer-use helper raised an internal error (%@). "
                                                        @"It is still running, so the next call can work; helper.log has the detail.",
                                                        detail]);
  }
}

/** One request, straight through — the handlers' own bodies live here. */
static NSDictionary *DispatchUnprotected(NSDictionary *request, NSString *directory,
                                        NSString *token) {
  id requestId = request[@"id"];

  NSString *presented = request[@"token"];
  if (![presented isKindOfClass:NSString.class] || ![presented isEqualToString:token]) {
    return ResponseWithError(requestId, @"unauthorized", @"Missing or incorrect token.");
  }

  NSString *method = request[@"method"];
  NSDictionary *params = [request[@"params"] isKindOfClass:NSDictionary.class] ? request[@"params"] : @{};

  // Every request is timed. The interesting failures here are slow ones — an app that stops
  // answering accessibility turns a walk into a stall — and a duration in the log is what
  // separates "the helper is broken" from "one app was busy".
  NSTimeInterval started = NSDate.date.timeIntervalSince1970;

  NSDictionary *outcome = nil;
  if ([method isEqualToString:@"status"]) {
    outcome = ResponseWithResult(requestId, HandleStatus(params));
  } else if ([method isEqualToString:@"request_access"]) {
    outcome = ResponseWithResult(requestId, HandleRequestAccess(params));
  } else if ([method isEqualToString:@"list_apps"]) {
    outcome = ResponseWithResult(requestId, HandleListApps(params));
  } else if ([method isEqualToString:@"get_state"]) {
    outcome = HandleGetState(params, directory);
  } else if ([method isEqualToString:@"act"]) {
    outcome = HandleAct(params, directory);
  } else if ([method isEqualToString:@"open_app"]) {
    outcome = ResponseWithResult(requestId, HandleOpenApp(params));
  } else if ([method isEqualToString:@"click"]) {
    outcome = ResponseWithResult(requestId, HandleClick(params, directory));
  } else if ([method isEqualToString:@"type"]) {
    outcome = ResponseWithResult(requestId, HandleType(params, directory));
  } else if ([method isEqualToString:@"key"]) {
    outcome = ResponseWithResult(requestId, HandleKey(params, directory));
  } else if ([method isEqualToString:@"scroll"]) {
    outcome = ResponseWithResult(requestId, HandleScroll(params, directory));
  } else if ([method isEqualToString:@"drag"]) {
    outcome = ResponseWithResult(requestId, HandleDrag(params, directory));
  } else if ([method isEqualToString:@"read_clipboard"]) {
    outcome = ResponseWithResult(requestId, HandleReadClipboard());
  } else if ([method isEqualToString:@"write_clipboard"]) {
    outcome = ResponseWithResult(requestId, HandleWriteClipboard(params));
  } else if ([method isEqualToString:@"list_windows"]) {
    outcome = ResponseWithResult(requestId, HandleListWindows(params));
  } else if ([method isEqualToString:@"displays"]) {
    outcome = ResponseWithResult(requestId, HandleDisplays());
  } else if ([method isEqualToString:@"screenshot"]) {
    outcome = ResponseWithResult(requestId, HandleScreenshot(params, directory));
  } else {
    outcome = ResponseWithError(requestId, @"bad_request",
                                [NSString stringWithFormat:@"Unknown method \"%@\".", method]);
  }

  // Handlers that can fail — `get_state`, `act` — build their own error body before they know
  // which request they are answering, so they return it without an id. Those same handlers
  // return a bare result on success, so both shapes need wrapping here. Without this a
  // successful reply went out with no id at all and the caller could never match it to the
  // request it sent, which looks exactly like a hang.
  if (!outcome[@"id"]) {
    outcome = outcome[@"error"]
                  ? ResponseWithError(requestId, outcome[@"error"][@"code"], outcome[@"error"][@"message"])
                  : ResponseWithResult(requestId, outcome);
  }

  NSTimeInterval elapsed = NSDate.date.timeIntervalSince1970 - started;
  if (elapsed > 1.0 || outcome[@"error"]) {
    Log(@"%@ took %.2fs%@", method, elapsed,
        outcome[@"error"] ? [NSString stringWithFormat:@" (%@)", outcome[@"error"][@"code"]] : @"");
  }

  return outcome;
}

#pragma mark - Socket server

/** Concurrent clients. Two is the real number today — the desktop app asks for permission
 *  state while the server drives tools — and the rest is headroom.
 *
 *  An enum rather than a `const int` because these sizes a stack array: only an integer
 *  constant expression is allowed there. */
enum { kMaxClients = 16 };

static NSString *ReadToken(NSString *tokenPath);
static BOOL ExistingHelperIsAlive(NSString *socketPath, NSString *token);

static BOOL WriteAll(int fd, const void *bytes, size_t length) {
  const char *cursor = bytes;
  while (length > 0) {
    ssize_t written = write(fd, cursor, length);
    if (written <= 0) {
      if (errno == EINTR) {
        continue;
      }
      return NO;
    }
    cursor += written;
    length -= (size_t)written;
  }
  return YES;
}

/**
 * Dispatch every complete line in `buffer`, leaving any trailing partial line in place.
 *
 * Requests are answered in the order they arrived on a connection, which is what a caller
 * that observes and then acts depends on.
 */
static BOOL DispatchBufferedLines(int clientFd, NSMutableData *buffer, NSString *directory, NSString *token) {
  NSData *newlineData = [@"\n" dataUsingEncoding:NSUTF8StringEncoding];

  while (YES) {
    NSRange newline = [buffer rangeOfData:newlineData options:0 range:NSMakeRange(0, buffer.length)];
    if (newline.location == NSNotFound) {
      return YES;
    }

    NSData *lineData = [buffer subdataWithRange:NSMakeRange(0, newline.location)];
    [buffer replaceBytesInRange:NSMakeRange(0, newline.location + newline.length)
                      withBytes:NULL
                         length:0];

    if (lineData.length == 0) {
      continue;
    }

    NSDictionary *request = nil;
    id parsed = [NSJSONSerialization JSONObjectWithData:lineData options:0 error:nil];
    if ([parsed isKindOfClass:NSDictionary.class]) {
      request = parsed;
    }

    NSDictionary *response = request
                                 ? Dispatch(request, directory, token)
                                 : ResponseWithError(@0, @"bad_request", @"Malformed JSON request.");

    NSData *payload = [NSJSONSerialization dataWithJSONObject:response options:0 error:nil];
    if (!payload) {
      Log(@"could not serialize a response for %@", request[@"method"] ?: @"?");
      continue;
    }
    NSMutableData *framed = [payload mutableCopy];
    [framed appendBytes:"\n" length:1];
    if (!WriteAll(clientFd, framed.bytes, framed.length)) {
      Log(@"write failed (%s) while answering %@", strerror(errno), request[@"method"] ?: @"?");
      return NO;
    }
  }
}

/**
 * Serve connections until the process is killed.
 *
 * Multiplexed with `poll` rather than served one at a time: the host app and the server are
 * separate clients, and a helper that handled a single connection would let whichever
 * connected first wedge the other one out — including by simply sitting idle.
 */
static int RunServer(NSString *socketPath, NSString *directory, NSString *tokenPath) {
  [NSFileManager.defaultManager createDirectoryAtPath:directory
                          withIntermediateDirectories:YES
                                           attributes:nil
                                                error:nil];

  NSString *token = ReadToken(tokenPath);
  if (!token.length) {
    Log(@"no token at %@; refusing to start", tokenPath);
    return 1;
  }

  if (ExistingHelperIsAlive(socketPath, token)) {
    Log(@"another helper already owns %@; exiting", socketPath);
    return 0;
  }

  // A socket file with nothing listening behind it is left over from a crash; it has to go
  // before bind() will accept this process on the same path.
  [NSFileManager.defaultManager removeItemAtPath:socketPath error:nil];

  if (strlen(socketPath.fileSystemRepresentation) >= sizeof(((struct sockaddr_un *)0)->sun_path)) {
    Log(@"socket path is too long: %@", socketPath);
    return 1;
  }

  int serverFd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (serverFd < 0) {
    Log(@"socket() failed: %s", strerror(errno));
    return 1;
  }

  struct sockaddr_un address;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  strncpy(address.sun_path, socketPath.fileSystemRepresentation, sizeof(address.sun_path) - 1);

  if (bind(serverFd, (struct sockaddr *)&address, sizeof(address)) != 0) {
    Log(@"bind(%@) failed: %s", socketPath, strerror(errno));
    close(serverFd);
    return 1;
  }

  // Owner-only: the socket path is guessable, so the file mode is what keeps another user's
  // process from reaching it at all.
  chmod(socketPath.fileSystemRepresentation, S_IRUSR | S_IWUSR);
  chmod(directory.fileSystemRepresentation, S_IRWXU);

  if (listen(serverFd, kMaxClients) != 0) {
    Log(@"listen() failed: %s", strerror(errno));
    close(serverFd);
    return 1;
  }

  Log(@"listening on %@", socketPath);

  // A peer that goes away mid-write must not kill the helper; the failed write is already
  // handled by WriteAll returning NO.
  signal(SIGPIPE, SIG_IGN);

  int clientFds[kMaxClients];
  NSMutableArray<NSMutableData *> *buffers = [NSMutableArray arrayWithCapacity:kMaxClients];
  for (int slot = 0; slot < kMaxClients; slot++) {
    clientFds[slot] = -1;
    [buffers addObject:[NSMutableData data]];
  }

  while (YES) {
    struct pollfd pollFds[kMaxClients + 1];
    int slotForPollIndex[kMaxClients + 1];
    int count = 0;

    pollFds[count].fd = serverFd;
    pollFds[count].events = POLLIN;
    pollFds[count].revents = 0;
    slotForPollIndex[count] = -1;
    count++;

    for (int slot = 0; slot < kMaxClients; slot++) {
      if (clientFds[slot] < 0) {
        continue;
      }
      pollFds[count].fd = clientFds[slot];
      pollFds[count].events = POLLIN;
      pollFds[count].revents = 0;
      slotForPollIndex[count] = slot;
      count++;
    }

    int ready = poll(pollFds, (nfds_t)count, -1);
    if (ready < 0) {
      if (errno == EINTR) {
        continue;
      }
      Log(@"poll() failed: %s", strerror(errno));
      break;
    }

    for (int index = 0; index < count; index++) {
      if (pollFds[index].revents == 0) {
        continue;
      }

      // A new peer. If every slot is taken the connection is closed rather than queued, so a
      // flood cannot grow the helper's memory.
      if (slotForPollIndex[index] < 0) {
        int clientFd = accept(serverFd, NULL, NULL);
        if (clientFd < 0) {
          continue;
        }
        int free = -1;
        for (int slot = 0; slot < kMaxClients; slot++) {
          if (clientFds[slot] < 0) {
            free = slot;
            break;
          }
        }
        if (free < 0) {
          Log(@"refusing a connection: all %d slots are busy", kMaxClients);
          close(clientFd);
          continue;
        }
        clientFds[free] = clientFd;
        buffers[(NSUInteger)free] = [NSMutableData data];
        continue;
      }

      int slot = slotForPollIndex[index];
      int clientFd = clientFds[slot];
      NSMutableData *buffer = buffers[(NSUInteger)slot];

      char chunk[65536];
      ssize_t received = read(clientFd, chunk, sizeof(chunk));
      if (received == 0 || (received < 0 && errno != EINTR)) {
        close(clientFd);
        clientFds[slot] = -1;
        buffers[(NSUInteger)slot] = [NSMutableData data];
        continue;
      }
      if (received < 0) {
        continue;
      }

      [buffer appendBytes:chunk length:(NSUInteger)received];
      if (buffer.length > 4 * 1024 * 1024) {
        Log(@"dropping a connection: request exceeded the line budget");
        close(clientFd);
        clientFds[slot] = -1;
        buffers[(NSUInteger)slot] = [NSMutableData data];
        continue;
      }

      if (!DispatchBufferedLines(clientFd, buffer, directory, token)) {
        close(clientFd);
        clientFds[slot] = -1;
        buffers[(NSUInteger)slot] = [NSMutableData data];
      }
    }
  }

  close(serverFd);
  return 0;
}

#pragma mark - Process lifecycle

/** Ask the socket that is already there whether a live helper owns it. */
static BOOL ExistingHelperIsAlive(NSString *socketPath, NSString *token) {
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) {
    return NO;
  }

  struct sockaddr_un address;
  memset(&address, 0, sizeof(address));
  address.sun_family = AF_UNIX;
  if (strlen(socketPath.fileSystemRepresentation) >= sizeof(address.sun_path)) {
    close(fd);
    return NO;
  }
  strncpy(address.sun_path, socketPath.fileSystemRepresentation, sizeof(address.sun_path) - 1);

  if (connect(fd, (struct sockaddr *)&address, sizeof(address)) != 0) {
    close(fd);
    return NO;
  }

  NSDictionary *ping = @{@"id" : @1, @"method" : @"status", @"token" : token ?: @""};
  NSData *payload = [NSJSONSerialization dataWithJSONObject:ping options:0 error:nil];
  NSMutableData *framed = [payload mutableCopy];
  [framed appendBytes:"\n" length:1];
  BOOL ok = WriteAll(fd, framed.bytes, framed.length);
  close(fd);
  return ok;
}

static NSString *ReadToken(NSString *tokenPath) {
  NSString *token = [NSString stringWithContentsOfFile:tokenPath
                                              encoding:NSUTF8StringEncoding
                                                 error:nil];
  return [token stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSString *socketPath = nil;
    NSString *directory = nil;
    NSString *tokenPath = nil;
    BOOL promptForAccess = NO;

    for (int index = 1; index < argc; index++) {
      NSString *argument = @(argv[index]);
      if ([argument isEqualToString:@"--socket"] && index + 1 < argc) {
        socketPath = @(argv[++index]);
      } else if ([argument isEqualToString:@"--dir"] && index + 1 < argc) {
        directory = @(argv[++index]);
      } else if ([argument isEqualToString:@"--token-file"] && index + 1 < argc) {
        tokenPath = @(argv[++index]);
      } else if ([argument isEqualToString:@"--prompt-access"]) {
        promptForAccess = YES;
      }
    }

    if (!directory.length) {
      NSString *support =
          [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES) firstObject];
      directory = [support stringByAppendingPathComponent:@"peakcode/computer-use"];
    }
    if (!socketPath.length) {
      socketPath = [directory stringByAppendingPathComponent:@"helper.sock"];
    }
    if (!tokenPath.length) {
      tokenPath = [directory stringByAppendingPathComponent:@"helper.token"];
    }

    // The helper is a background app: no dock icon, no menu bar, no window. It exists to
    // serve the socket and to hold the grant.
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];

    // From here on stderr has somewhere durable to land, which is what every later line —
    // including a crash report — depends on.
    RedirectStderr(directory);

    Log(@"starting v%s (protocol %d), app=%@", kHelperVersion, kProtocolVersion,
        NSBundle.mainBundle.bundlePath);

    // Only asked for right after a fresh install, where the user has just been told this
    // helper exists and the prompt is the obvious next step. Prompting on every launch would
    // keep nagging someone who has already decided not to grant it.
    if (promptForAccess) {
      HandleRequestAccess(@{});
    }

    return RunServer(socketPath, directory, tokenPath);
  }
}
