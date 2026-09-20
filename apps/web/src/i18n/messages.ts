// FILE: messages.ts
// Purpose: Centralize user-facing UI strings so the React tree can swap them by
//          language without touching call sites. Keys are grouped by surface so a
//          future move to a translation tool can re-export them as flat
//          namespaced ids. Templates use ${...} for interpolation.
// Layer: Shared runtime utility (web)
// Exports: Messages type, MESSAGES dictionary, NATIVE_LANGUAGE_LABELS

import type { Language } from "./language";

// Workspace file explorer: the sidebar tree plus the file preview panel.
export type FilesMessages = {
  showFiles: string;
  backToTasks: string;
  refresh: string;
  searchLabel: string;
  searchPlaceholder: string;
  clearSearch: string;
  changedOnly: string;
  showAll: string;
  emptyDirectory: string;
  loadingDirectory: string;
  searching: string;
  noResults: string;
  readFailed: string;
  workspaceUnavailable: string;
  workspacePending: string;
  changedFilesCount: (count: number) => string;
  copyRelativePath: string;
  copyAbsolutePath: string;
  copyPathFailed: string;
  openInEditor: string;
  openInEditorFailed: string;
  revealInFileManager: string;
  revealInFileManagerFailed: string;
  statusModified: string;
  statusAdded: string;
  statusDeleted: string;
  statusRenamed: string;
  statusUntracked: string;
  statusConflicted: string;
  viewer: {
    browseFiles: string;
    closeTab: string;
    closePanel: string;
    loading: string;
    loadFailed: string;
    fileMissing: string;
    binary: string;
    tooLarge: string;
    empty: string;
    previewMode: string;
    sourceMode: string;
    wrapLines: string;
    lineCount: (count: number) => string;
  };
};

export type Messages = {
  common: {
    cancel: string;
    save: string;
    delete: string;
    confirm: string;
    retry: string;
    close: string;
    open: string;
    ok: string;
    done: string;
    loading: string;
    yes: string;
    no: string;
    errorOccurred: string;
    unexpectedError: string;
    /** Asked before a screen closes (or a route change leaves it) with typed input in it. */
    unsavedChangesConfirm: string;
  };
  appShell: {
    connecting: string;
  };
  // The phone page a paired device opens: a remote control for this computer, with its
  // own copy because none of the desktop surface is rendered there.
  remoteControl: {
    title: string;
    connected: string;
    connecting: string;
    disconnected: string;
    disconnectedHint: string;
    notice: string;
    sectionTitle: string;
    counts: (workspaces: string, tasks: string) => string;
    bucket: {
      today: string;
      yesterday: string;
      earlier: string;
    };
    empty: string;
    retry: string;
    refresh: string;
    back: string;
    noMessages: string;
    composerPlaceholder: string;
    send: string;
    sending: string;
    stop: string;
    approve: string;
    deny: string;
    approvalTitle: string;
    status: {
      running: string;
      waiting: string;
      completed: string;
      failed: string;
      interrupted: string;
      idle: string;
    };
  };
  appNavigation: {
    back: string;
    backMac: string;
    backWin: string;
    forward: string;
    forwardMac: string;
    forwardWin: string;
  };
  errorFallback: {
    title: string;
    retry: string;
    reload: string;
    showDetails: string;
    hideDetails: string;
    unexpected: string;
    noDetails: string;
  };
  splash: {
    retry: string;
  };
  sidebar: {
    brandLabel: string;
    newChat: string;
    newDisposableTooltip: string;
    search: string;
    threads: string;
    workspace: string;
    recent: string;
    settings: string;
    addProject: string;
    noProjectsYet: string;
    noProjectsYetDescription: string;
    chooseProjectFolder: string;
    openingFolderPicker: string;
    addingProject: string;
    loadingProjects: string;
    toggleSidebar: string;
    codeLabel: string;
    disposableChat: string;
    pendingApproval: string;
    pluginsLabel: string;
    automationsLabel: string;
    kanbanLabel: string;
    automationsComingSoon: string;
    confirm: string;
    confirmArchive: string;
    archive: string;
    settingsAria: string;
    showMore: string;
    showLess: string;
    projectActionAdd: string;
    projectActionRename: string;
    projectActionRemove: string;
    projectActionCopyPath: string;
    projectActionArchive: string;
    projectActionDeleteThreads: string;
    intelOnArmTitle: string;
    sortProjects: string;
    sortThreads: string;
    sortRecentlyActive: string;
    sortRecentlyAdded: string;
    sortCreatedAt: string;
    sortManual: string;
    sortNewestFirst: string;
    projectSortMenuHeader: string;
    threadSortMenuHeader: string;
    pinThread: string;
    unpinThread: string;
    addProjectError: string;
    newChatError: string;
    openFolderError: string;
    linkUnavailable: string;
    openPRError: string;
    openFinderError: string;
    openTerminalError: string;
    removeProjectError: (name: string) => string;
    removeProjectSuccess: (name: string) => string;
    thread: {
      pinError: (action: "pin" | "unpin") => string;
      renameError: string;
      renameEmpty: string;
      handoffError: string;
      archiveRunningTitle: string;
      archiveRunningDescription: string;
      archiveEmpty: (projectName: string) => string;
      archiveFailedTitle: string;
      archiveSuccessOne: string;
      archiveSuccessMany: (count: number) => string;
      archiveError: string;
      deleteEmpty: string;
      deleteWorktreeWarning: string;
      deleteSuccessOne: string;
      deleteSuccessMany: (count: number) => string;
      deleteError: string;
      pathUnavailable: string;
      pathCopyUnavailable: string;
      pathOpenUnavailable: string;
      copyThreadId: string;
      copyThreadIdFailed: string;
      copyPath: string;
      copyPathFailed: string;
    };
    files: FilesMessages;
    update: {
      availableTitle: string;
      availableDescription: (version: string) => string;
      upToDateTitle: string;
      upToDateDescription: (version: string) => string;
      checkFailedTitle: string;
      checkFailedDescription: string;
      downloadedTitle: string;
      downloadedDescription: string;
      downloadFailedTitle: string;
      downloadFailedDescription: string;
      startFailedTitle: string;
      startFailedDescription: string;
      installFailedTitle: string;
      installFailedDescription: string;
      unexpectedError: string;
    };
    command: {
      newChat: {
        title: string;
        description: string;
      };
      newThread: {
        title: string;
        description: string;
      };
      addProject: {
        title: string;
        description: string;
      };
      attachSession: {
        title: string;
        description: string;
      };
      openSettings: {
        title: string;
        description: string;
      };
    };
    deleteWorkspace: string;
  };
  searchPalette: {
    importHeading: string;
    importDescription: string;
    backAria: string;
    providerLabel: string;
    noImportProviders: string;
    sessionIdLabel: string;
    sessionIdPlaceholder: string;
    sessionIdHelp: string;
    importAction: string;
    importing: string;
    importFailed: string;
    suggestedGroup: string;
    projectsGroup: string;
    configureGroup: string;
    darkThemesGroup: string;
    lightThemesGroup: string;
    darkColorTheme: string;
    lightColorTheme: string;
    followSystemTheme: string;
    followSystemThemeDescription: string;
    switchToLightTheme: string;
    switchToDarkTheme: string;
    lightThemeDescription: string;
    darkThemeDescription: string;
    applyToLightSlot: string;
    applyToDarkSlot: string;
    chatHits: (count: number) => string;
    chatMatch: string;
    projectMatch: string;
    untitledThread: string;
    untitledProject: string;
    noMatches: string;
    noMatchingFolders: string;
    inputHint: string;
    enterHint: string;
    searchPlaceholder: string;
    browsePlaceholder: string;
    add: string;
    createAndAdd: string;
    addHighlightedFolder: (label: string, modifier: string) => string;
    addWithEnter: (label: string) => string;
    addingProject: string;
    browseHint: string;
    enterToGoUp: string;
    enterToAddProject: string;
    enterToOpenWithModifier: (modifier: string) => string;
    createFolderHintPrefix: string;
    createFolderHintSuffix: string;
    errorEnterFolderPath: string;
    errorWindowsPath: string;
    errorRelativePath: string;
    errorAddProjectFallback: string;
  };
  chat: {
    loadingModels: string;
    newChat: string;
    handOff: string;
    run: string;
    stop: string;
    share: string;
    compact: string;
    plan: string;
    planModeHint: string;
    noActiveThread: string;
    selectOrCreate: string;
    clearUnavailable: string;
    clearUnavailableDescription: string;
    implementationFailed: string;
    handoffError: string;
    refreshProviderStatus: string;
    deletedAction: (name: string) => string;
    deleteActionFailed: string;
    updateAccessModeFailed: string;
    tooManyAttachments: (max: number) => string;
    browserAttachFailed: string;
    imagePreview: string;
    imagePreviewClose: string;
    imagePreviewPrev: string;
    imagePreviewNext: string;
    attachImagesAfterPlan: string;
    voice: {
      authRequiredTitle: string;
      authRequiredDescription: string;
      authSessionTitle: string;
      authSessionDescription: string;
      planUnansweredTitle: string;
      planUnansweredDescription: string;
      startFailedTitle: string;
      startFailedDescription: string;
      transcriptionUnavailableTitle: string;
      transcriptionUnavailableDescription: string;
      noAudioTitle: string;
      noAudioDescription: string;
      transcribeFailedTitle: string;
      transcribeFailedDescription: string;
    };
    continueInNewWorktree: string;
    reviewLocalChanges: string;
    reviewBranchDiff: string;
    composerPlaceholder: (providerName: string) => string;
    stopGenerationAria: string;
    stopGenerationTitle: string;
    implementationActionsAria: string;
    imagePlaceholder: (count: number) => string;
    renameError: string;
    renameEmpty: string;
    timeline: {
      editMessage: string;
      editAndResend: string;
      revertLabel: string;
      revertTooltip: string;
      undoUnavailable: string;
      emptyResponse: string;
      response: string;
      responseWithSummary: (summary: string) => string;
      showLess: string;
      showMore: string;
      showMoreCount: (count: number) => string;
      moreToolCalls: (count: number) => string;
      edited: string;
      oneFileChanged: string;
      filesChanged: (count: number) => string;
      collapseFiles: string;
      expandFiles: string;
      undo: string;
      workingFor: (duration: string) => string;
      workingForPrefix: string;
      working: string;
      emptyChat: string;
      activityThinking: string;
      activityRead: string;
      activityCommand: string;
      activityThinkingDuration: (duration: string) => string;
      activityDurationSeconds: (seconds: number) => string;
      activityDurationMinutes: (minutes: number, seconds: number) => string;
      activityReadSearchCount: (count: number) => string;
      activityReadFileCount: (count: number) => string;
    };
    copy: {
      buttonAria: string;
      success: string;
      failed: string;
    };
  };
  chatEmptyState: {
    title: string;
    subtitle: string;
    whatShouldWeWorkOn: string;
    whatShouldWeDoIn: string;
    thisFolder: string;
  };
  chatHeader: {
    closeSidechat: string;
  };
  chatRoute: {
    loadingDiff: string;
    splitPaneEmptyTitle: string;
    splitPaneEmptyProject: string;
  };
  composer: {
    placeholder: string;
    placeholderApproval: string;
    placeholderProgress: string;
    placeholderPlan: string;
    placeholderFollowUp: string;
    placeholderDisconnected: string;
    moreAria: string;
    extrasAria: string;
    addImage: string;
    pluginsLabel: string;
    pluginsHint: string;
    removePlugin: (name: string) => string;
    modeLabel: string;
    buildLabel: string;
    planLabel: string;
    localLabel: string;
    codexLabel: string;
    interactionMode: {
      agentHint: string;
      planHint: string;
      goalHint: string;
      switchHint: (label: string) => string;
      showPlanSidebar: string;
      hidePlanSidebar: string;
    };
    removeImage: string;
    pendingApproval: string;
    pendingUserInput: string;
    cancelTurn: string;
    decline: string;
    alwaysAllow: string;
    approveOnce: string;
    terminalContextExpired: string;
    voiceTranscribing: string;
    voiceStop: string;
    voiceRecord: string;
    voiceHoldToRecord: string;
    statusDialog: {
      local: string;
      worktree: string;
      newWorktreePending: string;
    };
    slashCommands: {
      local: string;
      worktree: string;
      plan: string;
      newChat: string;
    };
    contextWindowLabel: string;
    contextWindowPercent: (percent: number) => string;
    sendMessage: string;
    sendingBusy: string;
    sendingConnecting: string;
    sendingTranscribing: string;
    sendingPreparingWorktree: string;
    steer: string;
    deleteQueuedFollowUp: string;
    queuedFollowUpActions: string;
    queuedFollowUp: string;
  };
  skills: {
    title: string;
    subtitle: string;
    newSkill: string;
    browseSkillSh: string;
    searchPlaceholder: string;
    localHeading: string;
    localCount: string;
    localEmptyTitle: string;
    localEmptyDescription: string;
    localEmptySearchTitle: string;
    localEmptySearchDescription: string;
    providerHeading: string;
    providerHint: string;
    installedHeading: string;
    emptyTitle: string;
    emptyDescription: string;
    emptySearchTitle: string;
    emptySearchDescription: string;
    unavailableTitle: string;
    unavailableDescription: string;
    needsWorkspace: string;
    enableAria: (name: string) => string;
    enabledHint: string;
    disabledHint: string;
  };
  // The plugin marketplace surface. Category headings come from the manifest's machine key,
  // so an unknown one falls back to the raw value rather than disappearing.
  plugins: {
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    installedHeading: string;
    installedCount: string;
    refresh: string;
    loading: string;
    emptyTitle: string;
    emptyDescription: string;
    emptySearchTitle: string;
    emptySearchDescription: string;
    unavailableTitle: string;
    unavailableDescription: string;
    category: Record<string, string>;
    detailCapabilities: string;
    detailSkills: string;
    detailExamples: string;
    detailUse: string;
    useFailedTitle: string;
    useFailedDescription: string;
  };
  automations: {
    subtitle: string;
    newAutomation: string;
    emptyTitle: string;
    emptyDescription: string;
    noWorkspaceTitle: string;
    noWorkspaceDescription: string;
    loading: string;
    createTitle: string;
    editTitle: string;
    taskTitle: string;
    taskTitlePlaceholder: string;
    instructions: string;
    instructionsHint: string;
    instructionsPlaceholder: string;
    workspace: string;
    selectWorkspace: string;
    workspaceMissing: string;
    plan: string;
    planKinds: {
      once: string;
      daily: string;
      weekly: string;
    };
    onceAt: string;
    time: string;
    weekdays: string;
    /** Indexed by `Date.prototype.getDay()`: 0 = Sunday. */
    weekdayLabels: ReadonlyArray<string>;
    timezone: string;
    mode: string;
    modes: {
      default: string;
      plan: string;
      goal: string;
    };
    create: string;
    save: string;
    cancel: string;
    creating: string;
    saving: string;
    createFailed: string;
    runNow: string;
    edit: string;
    delete: string;
    deleteConfirmTitle: string;
    deleteConfirmDescription: string;
    enable: string;
    disable: string;
    disabled: string;
    openConversation: string;
    runsHeading: string;
    noRuns: string;
    nextRun: string;
    noNextRun: string;
    lastRun: string;
    never: string;
    runStatus: {
      running: string;
      succeeded: string;
      failed: string;
      interrupted: string;
    };
    triggerManual: string;
    scheduleDaily: (time: string) => string;
    scheduleWeekly: (days: string, time: string) => string;
    scheduleOnce: (at: string) => string;
    createdToast: string;
    savedToast: string;
    deletedToast: string;
    runStartedToast: string;
    runFailedToast: string;
    chatHint: string;
  };
  kanban: {
    subtitle: string;
    project: string;
    selectProject: string;
    addTask: string;
    newTask: string;
    editTask: string;
    taskTitle: string;
    taskTitlePlaceholder: string;
    taskDescription: string;
    taskDescriptionPlaceholder: string;
    taskImages: string;
    addImage: string;
    imageHint: string;
    removeImage: string;
    imageRejected: string;
    agent: string;
    agentModel: string;
    defaultModel: string;
    defaultModelWithName: (name: string) => string;
    agentRun: string;
    agentRunRunning: string;
    agentRunDone: string;
    agentRunFailed: string;
    agentRunInterrupted: string;
    agentRunUnknown: string;
    openThread: string;
    priority: string;
    status: string;
    pipeline: string;
    pipelinePlaceholder: string;
    assignee: string;
    assigneePlaceholder: string;
    create: string;
    unsavedChangesConfirm: string;
    save: string;
    cancel: string;
    deleteTask: string;
    deleteTaskConfirm: string;
    noTasks: string;
    loading: string;
    updatedLabel: string;
    boardFileLabel: string;
    filterAll: string;
    searchPlaceholder: string;
    clearSearch: string;
    viewBoard: string;
    viewList: string;
    clearFilters: string;
    noMatches: string;
    noMatchesDescription: string;
    noMatchesColumn: string;
    taskId: string;
    unassigned: string;
    showSidebar: string;
    hideSidebar: string;
    addTaskIn: (column: string) => string;
    taskCount: (count: number) => string;
    showingCount: (count: number) => string;
    boardTab: string;
    listTab: string;
    refreshBoard: string;
    switchProject: string;
    backToAgents: string;
    hiddenColumns: string;
    hiddenColumnsEmpty: string;
    columnActions: (column: string) => string;
    hideColumn: string;
    showAllColumns: string;
    revealColumn: (column: string) => string;
    createdLabel: string;
    sections: {
      projects: string;
    };
    noProjectsTitle: string;
    noProjectsDescription: string;
    columns: {
      todo: string;
      inProgress: string;
      done: string;
      blocked: string;
      archived: string;
    };
    priorities: {
      high: string;
      medium: string;
      low: string;
    };
    failure: {
      requirementTitle: string;
      modelAccessDenied: string;
      authFailed: string;
      modelNotFound: string;
      timeout: string;
      providerError: string;
      model: (model: string) => string;
    };
    detail: {
      back: string;
      requirement: string;
      requirementEmpty: string;
      requirementAppendHint: string;
      requirementEditHint: string;
      editRequirement: string;
      saveRequirement: string;
      comments: string;
      noComments: string;
      commentPlaceholder: string;
      sendComment: string;
      generateRequirement: string;
      generatingRequirement: string;
      generateRequirementConfirm: string;
      generateRequirementHint: string;
      steerComment: string;
      steerUnavailable: string;
      interruptRun: string;
      authorAgent: string;
      authorUser: string;
      statusStarted: string;
      statusDone: string;
      statusFailed: string;
      statusInterrupted: string;
      statusSteered: string;
      commentCount: (count: number) => string;
      loading: string;
      notFound: string;
    };
  };
  settings: {
    title: string;
    restoreDefaults: string;
    backToApp: string;
    nav: {
      general: { label: string; description: string };
      appearance: { label: string; description: string };
      notifications: { label: string; description: string };
      behavior: { label: string; description: string };
      skills: { label: string; description: string };
      piPackages: { label: string; description: string };
      worktrees: { label: string; description: string };
      archived: { label: string; description: string };
      modelProviders: { label: string; description: string };
      advanced: { label: string; description: string };
      channels: { label: string; description: string };
      usage: { label: string; description: string };
    };
    groups: {
      basics: string;
      agent: string;
      data: string;
    };
    general: {
      heading: string;
      description: string;
      coreDefaults: string;
      sidebarOrganization: string;
      language: {
        title: string;
        description: string;
        english: string;
        chinese: string;
      };
      defaultProvider: {
        title: string;
        description: string;
        resetLabel: string;
      };
      defaultModel: {
        title: string;
        description: string;
        resetLabel: string;
        automatic: string;
        automaticDescription: string;
      };
      newThreads: {
        title: string;
        description: string;
        resetLabel: string;
        local: string;
        worktree: string;
      };
      sidebarPosition: {
        title: string;
        description: string;
        left: string;
        right: string;
        resetLabel: string;
      };
      projectOrder: {
        title: string;
        description: string;
        recentlyActive: string;
        recentlyAdded: string;
        manual: string;
        resetLabel: string;
      };
      threadOrder: {
        title: string;
        description: string;
        recentlyActive: string;
        newestFirst: string;
        resetLabel: string;
      };
    };
    appearance: {
      heading: string;
      description: string;
      themeAndTypographySection: string;
      timeAndReadingSection: string;
      theme: {
        title: string;
        description: string;
        system: string;
        light: string;
        dark: string;
        systemDescription: string;
        lightDescription: string;
        darkDescription: string;
      };
      lightThemeCard: {
        title: string;
        contextActive: string;
        contextInactive: string;
        contextSystemActive: string;
        contextSystemInactive: string;
      };
      darkThemeCard: {
        title: string;
        contextActive: string;
        contextInactive: string;
        contextSystemActive: string;
        contextSystemInactive: string;
      };
      themePackReset: string;
      themePackCopy: string;
      themePackImport: string;
      themePackShareStringAria: string;
      themePackCodeThemeAria: (label: string) => string;
      themePackTranslucentAria: (label: string) => string;
      themePackResetAria: (label: string) => string;
      themePackHexAria: (label: string) => string;
      accent: string;
      background: string;
      foreground: string;
      uiFontLabel: string;
      codeFontLabel: string;
      translucentSidebar: string;
      contrast: string;
      timestamp: {
        title: string;
        description: string;
        systemDefault: string;
        twelveHour: string;
        twentyFourHour: string;
        ariaLabel: string;
      };
      typography: {
        title: string;
        description: string;
        uiFont: string;
        codeFont: string;
        baseFontSize: string;
        fontSmoothing: string;
        uiFontDescription: string;
        codeFontDescription: string;
        baseFontSizeDescription: string;
        fontSmoothingDescription: string;
        uiFontAria: string;
        codeFontAria: string;
        baseFontSizeAria: string;
        fontSmoothingAria: string;
        unitPx: string;
      };
    };
    notifications: {
      heading: string;
      description: string;
      activityAlertsSection: string;
      unavailableTitle: string;
      supportBrowserBlocked: string;
      supportBrowserPrompt: string;
      supportBrowserGranted: string;
      supportDesktopUnsupported: string;
      supportDesktopGranted: string;
      supportDesktopDenied: string;
      testTitle: string;
      testBody: string;
      testSuccessTitle: string;
      testUnavailableTitle: string;
      testSuccessDescriptionDesktop: string;
      testUnavailableDescriptionDesktop: string;
      testSuccessDescriptionBrowser: string;
      testButton: string;
      activityToasts: {
        title: string;
        description: string;
        ariaLabel: string;
      };
      desktopNotifications: {
        title: string;
        description: string;
        ariaLabel: string;
      };
    };
    behavior: {
      heading: string;
      description: string;
      runtimeSection: string;
      safetySection: string;
      assistantOutput: string;
      assistantOutputDescription: string;
      assistantOutputAria: string;
      diffLineWrapping: string;
      diffLineWrappingDescription: string;
      diffLineWrappingAria: string;
      deleteConfirmation: string;
      deleteConfirmationDescription: string;
      deleteConfirmationAria: string;
      archiveConfirmation: string;
      archiveConfirmationDescription: string;
      archiveConfirmationAria: string;
      terminalCloseConfirmation: string;
      terminalCloseConfirmationDescription: string;
      terminalCloseConfirmationAria: string;
    };
    worktrees: {
      heading: string;
      description: string;
      managedSection: string;
      loading: string;
      loadFailedFallback: string;
      emptyState: string;
      worktreeLabel: string;
      conversationsLabel: string;
      noConversations: string;
      deleteButton: string;
      deleteWarning: string;
      verifyTitle: string;
      verifyDescription: string;
      deleteConfirmWithLinks: (name: string, count: number) => string;
      deleteConfirm: (name: string) => string;
      deleteAnyway: string;
      deleteLinkedActive: (active: number) => string;
      deleteLinkedArchived: (archived: number) => string;
      deleteArchivedWillDeleteFirst: string;
      deleteLinkedWarning: string;
      deleteRemovesFromDisk: string;
      deletedTitle: string;
      deletedDescriptionWithArchived: (name: string, count: number) => string;
      deletedDescription: (name: string) => string;
      deleteErrorTitle: string;
      deleteErrorFallback: string;
    };
    archived: {
      heading: string;
      description: string;
      emptySection: string;
      emptyTitle: string;
      emptyDescription: string;
      unknownProject: string;
      archivedAt: (when: string) => string;
      restoreButton: string;
      deleteButton: string;
      restoreTitle: string;
      restoreDescription: string;
      restoreErrorTitle: string;
      restoreErrorFallback: string;
      deleteConfirm: (title: string) => string;
      deleteTitle: string;
      deleteDescription: string;
      deleteErrorTitle: string;
      deleteErrorFallback: string;
      contextMenuRestore: string;
      contextMenuDelete: string;
    };
    models: {
      heading: string;
      description: string;
      generationSection: string;
      customSection: string;
      gitWritingModel: string;
      gitWritingModelDescription: string;
      gitWritingModelAria: string;
      customModelEmpty: string;
      customModelBuiltIn: string;
      customModelTooLong: (max: number) => string;
      customModelDuplicate: string;
      customModelResetLabel: string;
      customAddPlaceholder: string;
      customAddButton: string;
      customAddAria: string;
      customProviderAria: string;
      customRemoveAria: (slug: string) => string;
      customShowLess: string;
      customShowMore: (count: number) => string;
      savedModelSlugs: string;
      savedModelSlugsDescription: string;
    };
    providers: {
      heading: string;
      description: string;
      updatesSection: string;
      pickerSection: string;
      toolsSection: string;
      installTitle: (providerName: string) => string;
      visibility: {
        title: string;
        description: string;
        statusAllVisible: string;
        statusCustomOrder: string;
        statusHidden: (count: number) => string;
        statusHiddenOne: string;
        showAria: (name: string) => string;
        reorderAria: (name: string) => string;
        resetLabel: string;
      };
      updates: {
        title: string;
        description: string;
        statusNoUpdates: string;
        statusAvailableOne: string;
        statusAvailableMany: (count: number) => string;
        statusAvailablePlural: (count: number) => string;
        manualUpdate: string;
        updateButton: string;
        updatingButton: string;
        commandLabel: string;
        runCommandTitle: (command: string) => string;
        versionAdvisoryNoCommand: string;
      };
      tools: {
        title: string;
        description: string;
        statusNoUpdates: string;
        statusAvailableOne: string;
        statusAvailableMany: (count: number) => string;
        statusAvailablePlural: (count: number) => string;
        customBadge: string;
        resetLabel: string;
        binaryPathLabel: (providerName: string) => string;
        homePathLabel: string;
        homePathDescription: string;
        agentDirLabel: string;
        agentDirDescription: string;
        apiEndpointLabel: string;
        apiEndpointDescription: string;
        serverUrlLabel: (providerName: string) => string;
        serverUrlDescription: (providerName: string) => string;
        serverPasswordLabel: (providerName: string) => string;
        serverPasswordDescription: (providerName: string) => string;
        binaryPathDescription: (command: string) => string;
        binaryPathPlaceholder: (providerName: string) => string;
        homePathPlaceholder: string;
        agentDirPlaceholder: string;
        apiEndpointPlaceholder: string;
        serverUrlPlaceholder: string;
        serverPasswordPlaceholder: (providerName: string) => string;
      };
      docs: {
        install: string;
        update: string;
        config: string;
        headless: string;
        label: string;
      };
      update: {
        queued: string;
        updating: string;
        updated: string;
        failed: string;
        stillOutdated: string;
        versionDelta: (current: string, latest: string) => string;
        latest: (version: string) => string;
        current: (version: string) => string;
        errorFallback: string;
      };
      cliDocs: string;
    };
    modelProviders: {
      heading: string;
      description: string;
      filePathLabel: string;
      builtinHint: string;
      emptyTitle: string;
      emptyDescription: string;
      loadFailedTitle: string;
      builtinGroupLabel: string;
      customGroupLabel: string;
      loadFailedFallback: string;
      addButton: string;
      addDialogTitle: string;
      templateLabel: string;
      templateAria: string;
      templateCustom: string;
      providerExistsHint: (name: string) => string;
      providerKeyLabel: string;
      providerNameLabel: string;
      providerApiLabel: string;
      providerBaseUrlLabel: string;
      providerApiKeyLabel: string;
      providerApiKeyHint: string;
      providerApiKeyPlaceholder: (env: string) => string;
      providerStoredKeyHint: string;
      providerClearKeyButton: string;
      providerModelsLabel: string;
      modelAddButton: string;
      modelFetchButton: string;
      remoteModelsTitle: (provider: string) => string;
      remoteModelsLoading: string;
      remoteModelsFailed: string;
      remoteModelsSummary: (total: number, missing: number) => string;
      remoteModelsSearchPlaceholder: string;
      remoteModelsEmpty: string;
      remoteModelsNoMatch: string;
      remoteModelsAdd: string;
      remoteModelsAdded: string;
      remoteModelsAddAria: (id: string) => string;
      remoteModelsAddAll: string;
      remoteModelsAddGroup: string;
      remoteModelsGroupOther: string;
      remoteModelsAddedCount: (count: number) => string;
      modelCategoryAll: string;
      modelCategories: Record<
        "chat" | "embedding" | "rerank" | "tts" | "asr" | "image" | "video" | "music" | "other",
        string
      >;
      modelIdLabel: string;
      modelIdPlaceholder: string;
      modelContextLabel: string;
      modelContextBadge: (value: string) => string;
      modelMaxTokensLabel: string;
      modelMaxTokensBadge: (value: string) => string;
      modelInputTypesLabel: string;
      modelOutputTypesLabel: string;
      inputTypes: Record<"text" | "image" | "video" | "pdf", string>;
      modelAddTitle: string;
      modelEditTitle: string;
      modelSaveButton: string;
      modelEditAria: (id: string) => string;
      modelRemoveAria: (id: string) => string;
      providerRemoveAria: (name: string) => string;
      providerRemoveConfirm: (name: string) => string;
      saveButton: string;
      savingButton: string;
      savedTitle: string;
      testButton: string;
      testHint: string;
      testAutoSaveHint: string;
      enableButton: string;
      enableSavingButton: string;
      enabledStatus: string;
      disabledStatus: string;
      enablePaneTitle: (name: string) => string;
      enablePaneHint: string;
      testResults: Record<
        | "success"
        | "invalid-config"
        | "model-not-found"
        | "auth-missing"
        | "timeout"
        | "request-failed",
        string
      >;
      unsavedHint: string;
      cancelButton: string;
    };
    channels: {
      heading: string;
      description: string;
      names: {
        wechat: string;
        feishu: string;
        qq: string;
        wecom: string;
        wechatMp: string;
        webhook: string;
      };
      status: {
        connected: string;
        connecting: string;
        off: string;
        failed: string;
        notConfigured: string;
      };
      actions: {
        save: string;
        saving: string;
        saved: string;
        /** Opens a card's credential fields; it is not the save action. */
        edit: string;
        test: string;
        testing: string;
        disconnect: string;
        forget: string;
        refresh: string;
      };
      wechat: {
        title: string;
        description: string;
        scan: string;
        rescan: string;
        scanHint: string;
        waiting: string;
        scanned: string;
        expired: string;
        confirmed: string;
        disconnectConfirm: string;
      };
      feishu: {
        title: string;
        description: string;
        domain: string;
        domainFeishu: string;
        domainLark: string;
        appId: string;
        appSecret: string;
        secretPlaceholder: string;
      };
      qq: {
        title: string;
        description: string;
        appId: string;
        appSecret: string;
      };
      wecom: {
        title: string;
        description: string;
        callbackHint: string;
        corpId: string;
        agentId: string;
        secret: string;
        callbackToken: string;
        encodingAesKey: string;
      };
      wechatMp: {
        title: string;
        description: string;
        callbackHint: string;
        appId: string;
        appSecret: string;
        callbackToken: string;
        encodingAesKey: string;
      };
      webhooks: {
        title: string;
        description: string;
        wecomUrl: string;
        dingtalkUrl: string;
        dingtalkSecret: string;
        inboundSecret: string;
        taskHint: string;
      };
      behavior: {
        title: string;
        description: string;
        project: string;
        projectAuto: string;
        idleHours: string;
        idleHoursHint: string;
        runtimeMode: string;
        modeApproval: string;
        modeFull: string;
        runtimeModeHint: string;
      };
      conversations: {
        title: string;
        description: string;
        empty: string;
        forget: string;
      };
      log: {
        title: string;
        empty: string;
        incoming: string;
        outgoing: string;
        error: string;
      };
      mobile: {
        title: string;
        description: string;
        phoneTitle: string;
        phoneDescription: string;
        waiting: string;
        ready: string;
        stop: string;
        refresh: string;
        copyLink: string;
        copied: string;
        linkHint: string;
        botTitle: string;
        botDescription: string;
        openSettings: string;
        manageTitle: string;
        manageDescription: string;
        manageEmpty: string;
        loadFailed: string;
        sidebarTooltip: string;
        opensThread: (title: string) => string;
        opensProject: (project: string) => string;
        defaultModelSet: (model: string) => string;
        defaultModelUnset: string;
      };
      remote: {
        title: string;
        description: string;
        start: string;
        starting: string;
        stop: string;
        connected: string;
        connecting: string;
        off: string;
        failed: string;
        urlLabel: string;
        copy: string;
        copied: string;
        publicWarning: string;
        needsToken: string;
        autoStart: string;
        autoStartHint: string;
        binaryPath: string;
        binaryPathHint: string;
        lastUrl: string;
        openHint: string;
      };
    };
    usage: {
      badge: string;
      scope: (days: string) => string;
      refresh: string;
      loading: string;
      errorTitle: string;
      emptyTitle: string;
      emptyDescription: string;
      generatedAt: (time: string) => string;
      filter: {
        label: string;
        all: string;
      };
      stats: {
        cumulativeTokens: string;
        peakTokens: string;
        longestChat: string;
        currentStreak: string;
        longestStreak: string;
      };
      mix: {
        title: string;
        input: string;
        output: string;
        cacheRead: string;
        cacheWrite: string;
      };
      tools: {
        title: string;
        description: string;
        inactive: string;
        sessions: (count: string) => string;
        models: (count: string) => string;
        lastUsed: (time: string) => string;
      };
      activity: {
        title: string;
        daily: string;
        weekly: string;
        cumulative: string;
        tokensUnit: string;
        responses: (count: string) => string;
        weekTotal: (tokens: string) => string;
        cumulativeTotal: (tokens: string) => string;
      };
      range: {
        label: string;
        last7: string;
        last30: string;
      };
      trend: {
        title: string;
      };
      models: {
        title: string;
        other: string;
      };
      sessions: {
        title: string;
        project: string;
        duration: string;
        requests: string;
        requestCount: (count: string) => string;
        detail: string;
        detailTitle: string;
        detailEmpty: string;
        dropped: (count: string) => string;
        unavailable: string;
        time: string;
        model: string;
        input: string;
        output: string;
        cache: string;
        total: string;
        close: string;
      };
    };
    piPackages: {
      heading: string;
      description: string;
      settingsPathLabel: string;
      sourceLabel: string;
      sourcePlaceholder: string;
      sourceHint: string;
      installButton: string;
      installingButton: string;
      loadingLabel: string;
      loadFailedTitle: string;
      loadFailedFallback: string;
      emptyTitle: string;
      emptyDescription: string;
      projectScopeLabel: string;
      filteredLabel: string;
      notInstalledLabel: string;
      reloadHint: string;
      resources: {
        skills: string;
        prompts: string;
        extensions: string;
        themes: string;
      };
      removeConfirm: (source: string) => string;
      removeAria: (source: string) => string;
    };
    advanced: {
      heading: string;
      description: string;
      developerSection: string;
      aboutSection: string;
      keybindings: {
        title: string;
        description: string;
        pathPlaceholder: string;
        openEditorHint: string;
        openButton: string;
        openingButton: string;
        noEditor: string;
        openError: string;
        noEditorToast: string;
        openErrorFallback: string;
        openErrorUnknown: string;
      };
      recovery: {
        title: string;
        description: string;
        offerReason: string;
        hiddenReason: string;
        whatThisDoesLabel: string;
        whatThisDoesBody: string;
        repairButton: string;
        repairingButton: string;
        confirmTitle: string;
        confirmDescription: string;
        confirmSpacer: string;
        successTitle: string;
        successDescription: string;
        errorTitle: string;
        errorFallback: string;
      };
      version: {
        title: string;
        description: string;
      };
    };
    themePack: {
      importTitle: string;
      importDescription: string;
      apply: string;
      reset: string;
    };
    changedSettingLabel: {
      theme: string;
      darkThemePack: string;
      lightThemePack: string;
      defaultProvider: string;
      defaultModel: string;
      newThreadMode: string;
      sidebarPosition: string;
      projectSortOrder: string;
      threadSortOrder: string;
      uiFont: string;
      codeFont: string;
      baseFontSize: string;
      fontSmoothing: string;
      timeFormat: string;
      activityToasts: string;
      desktopNotifications: string;
      assistantOutput: string;
      diffLineWrapping: string;
      deleteConfirmation: string;
      archiveConfirmation: string;
      terminalCloseConfirmation: string;
      gitWritingModel: string;
      customModels: string;
      providerInstalls: string;
      providerVisibility: string;
      providerOrder: string;
      language: string;
    };
    resetAria: (label: string) => string;
    resetTooltip: string;
    restoreDefaultsConfirm: (labels: string) => string;
  };
  dialog: {
    confirm: {
      deleteThread: (title: string) => string;
      deleteThreadPermanent: string;
      archiveThread: string;
      removeProject: (name: string) => string;
      removeProjectAndThreads: (name: string, count: number) => string;
      cancel: string;
      continue: string;
      discardDraft: string;
    };
    rename: {
      title: string;
      description: string;
      submit: string;
      cancel: string;
    };
    pullRequest: {
      title: string;
      description: string;
      placeholder: string;
      open: string;
      cancel: string;
    };
    worktreeHandoff: {
      title: string;
      description: string;
      submit: string;
      cancel: string;
    };
  };
  whatsNew: {
    title: string;
    popoutTitle: string;
    open: string;
    dismiss: string;
    gotIt: string;
    releaseNotes: string;
    readMore: string;
    showLess: string;
    highlights: string;
    allReleases: string;
    versionLabel: (version: string) => string;
  };
  taskCompletion: {
    markAllRead: string;
    viewChat: string;
  };
  workspace: {
    fallbackTitle: string;
    renameHint: string;
    terminalTab: string;
    settingsAria: string;
    loading: string;
    emptyTitle: string;
    openInEditor: string;
  };
  terminal: {
    findPlaceholder: string;
    matchCase: string;
    tabTerminal: string;
    tabChat: string;
  };
  gitActions: {
    groupAria: string;
    optionsAria: string;
    prTitlePlaceholder: string;
    linkUnavailable: string;
    noOpenPR: string;
    openPRErrorTitle: string;
    syncingTitle: string;
    syncSuccess: string;
    alreadyUpToDate: string;
    syncFailed: string;
    createPRUnavailable: string;
    noChanges: string;
    running: string;
    waiting: string;
    keeping: (name: string) => string;
    branchConfirmed: string;
    creatingBranch: string;
    switchedTo: (name: string) => string;
    createdCheckedOut: string;
    createFailed: string;
    editorUnavailable: string;
    openFileFailed: string;
  };
  browser: {
    screenshotCopied: string;
    urlPlaceholder: string;
    actionsAria: string;
  };
  branchToolbar: {
    newWorktree: string;
    handoffNewWorktree: string;
    handoffLocal: string;
    rateLimitsRemaining: string;
    checkoutPR: string;
    searchPlaceholder: string;
    createTitle: string;
    discardStash: string;
    loadingStash: string;
    fieldBranch: string;
    fieldWorktree: string;
    fieldStash: string;
    fieldName: string;
  };
  projectScripts: {
    groupAria: string;
    actionAria: string;
    editAria: (name: string) => string;
    nameLabel: string;
    chooseIcon: string;
    testPlaceholder: string;
    keybindingLabel: string;
    pressShortcut: string;
    pressShortcutHint: string;
    commandLabel: string;
    autoRunLabel: string;
    deleteConfirmDescription: string;
    addScript: string;
    delete: string;
    deleteConfirmTitle: (name: string) => string;
    deleteAction: string;
  };
  themeEditor: {
    copiedTitle: string;
    copiedDescription: (variant: string) => string;
    copyFailedTitle: string;
    copyFailedDescription: string;
    codeAria: (label: string) => string;
    systemDefault: string;
    translucentSidebar: string;
    translucentSidebarAria: (label: string) => string;
    resetAria: (label: string) => string;
    resetTitle: string;
    hexValueAria: (label: string) => string;
    importedTitle: string;
    importedDescription: (variant: string) => string;
    shareStringAria: string;
    background: string;
    text: string;
    accent: string;
    border: string;
    status: string;
    code: string;
    light: string;
    dark: string;
    reset: string;
    shareString: string;
    apply: string;
    import: string;
    foreground: string;
    uiFont: string;
    codeFont: string;
    codeFontPlaceholder: string;
    contrast: string;
    contextActiveSystem: (variant: string) => string;
    contextActiveLocked: string;
    contextInactiveSystem: (variant: string) => string;
    contextInactiveLocked: (mode: string) => string;
    importDialogTitle: (variant: string) => string;
    importDialogDescription: (variant: string) => string;
    importDialogCancel: string;
    importDialogSubmit: string;
    importError: string;
    importPlaceholder: string;
    copy: string;
  };
  themePack: {
    importTitle: string;
    importDescription: string;
    apply: string;
    reset: string;
  };
  restoreDefaults: {
    title: string;
    description: (labels: string) => string;
    button: string;
  };
  keybindings: {
    searchPlaceholder: string;
    title: string;
  };
  rateLimits: {
    reachedTitle: string;
    approachingTitle: string;
    planLimitTitle: string;
    noData: string;
  };
  providerUsage: {
    title: (providerName: string) => string;
    fallbackTitle: string;
    window: string;
    resetsAt: string;
    noData: string;
  };
  debug: {
    actionFailed: string;
    fallback: string;
  };
  notification: {
    retention: {
      title: string;
      preparing: string;
      progress: (purged: number, total: number) => string;
      progressSimple: (purged: number) => string;
      compactingTitle: string;
      compactingReclaim: string;
      compactingFinishing: string;
      pausedTitle: string;
      pausedDescription: string;
      successTitle: string;
      successDescription: (purged: number) => string;
      successDescriptionEmpty: string;
    };
    providerUpdate: {
      title: (providerName: string) => string;
      titleMany: (count: number) => string;
      description: (providerName: string) => string;
      descriptionMany: (count: number) => string;
      errorFallback: string;
      stillOutdated: string;
      requestFailed: string;
      failedTitleAll: string;
      failedTitleSome: string;
      successTitleOne: (providerName: string) => string;
      successTitleMany: (count: number) => string;
      successDescription: string;
      availableTitleOne: (providerName: string) => string;
      availableTitleMany: (count: number) => string;
      availableDescriptionOne: (providerName: string) => string;
      availableDescriptionMany: (providerName: string, count: number) => string;
      actionReview: string;
      actionUpdateAll: string;
    };
    keybindings: {
      invalidTitle: string;
      openConfigAction: string;
      noEditor: string;
      openFileErrorTitle: string;
      openFileErrorFallback: string;
    };
  };
};

const en: Messages = {
  common: {
    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    confirm: "Confirm",
    retry: "Retry",
    close: "Close",
    open: "Open",
    ok: "OK",
    done: "Done",
    loading: "Loading...",
    yes: "Yes",
    no: "No",
    errorOccurred: "An error occurred.",
    unexpectedError: "An unexpected error occurred.",
    unsavedChangesConfirm: "You have unsaved changes. Discard them?",
  },
  appShell: {
    connecting: "Connecting to {name} server...",
  },
  remoteControl: {
    title: "Peak Code remote control",
    connected: "Connected to the desktop window on this computer",
    connecting: "Connecting to the desktop…",
    disconnected: "Not connected",
    disconnectedHint:
      "This page drives a Peak Code desktop that is already running. If the code expired or the desktop closed, open the phone icon there and scan again.",
    notice:
      "This connection can see the workspaces and tasks that are open on this computer, and everything you send still runs there. The link is one-time: when it expires, reconnect from the desktop.",
    sectionTitle: "Workspaces and tasks on this computer",
    counts: (workspaces, tasks) => `${workspaces} workspaces · ${tasks} tasks`,
    bucket: {
      today: "Today",
      yesterday: "Yesterday",
      earlier: "Earlier",
    },
    empty: "No tasks on this computer yet.",
    retry: "Try again",
    refresh: "Refresh",
    back: "Back",
    noMessages: "No messages yet.",
    composerPlaceholder: "Continue this conversation…",
    send: "Send",
    sending: "Sending…",
    stop: "Stop",
    approve: "Allow",
    deny: "Deny",
    approvalTitle: "Waiting for your decision",
    status: {
      running: "Running",
      waiting: "Needs you",
      completed: "Done",
      failed: "Failed",
      interrupted: "Stopped",
      idle: "Idle",
    },
  },
  appNavigation: {
    back: "Back",
    backMac: "Back (⌘[)",
    backWin: "Back (Alt+←)",
    forward: "Forward",
    forwardMac: "Forward (⌘])",
    forwardWin: "Forward (Alt+→)",
  },
  errorFallback: {
    title: "Something went wrong.",
    retry: "Try again",
    reload: "Reload app",
    showDetails: "Show error details",
    hideDetails: "Hide error details",
    unexpected: "An unexpected router error occurred.",
    noDetails: "No additional error details are available.",
  },
  splash: {
    retry: "Retry",
  },
  sidebar: {
    brandLabel: "Peak",
    newChat: "New chat",
    newDisposableTooltip: "New disposable chat",
    search: "Search",
    threads: "Threads",
    workspace: "Workspace",
    recent: "Recent",
    settings: "Settings",
    addProject: "Add project",
    noProjectsYet: "No projects yet",
    noProjectsYetDescription: "Choose a local project folder to start your first thread.",
    chooseProjectFolder: "Choose project folder",
    openingFolderPicker: "Opening...",
    addingProject: "Adding...",
    loadingProjects: "Loading projects",
    toggleSidebar: "Toggle thread sidebar",
    codeLabel: "Code",
    disposableChat: "Disposable chat",
    pendingApproval: "Pending approval",
    pluginsLabel: "Plugins",
    automationsLabel: "Automations",
    kanbanLabel: "Kanban",
    automationsComingSoon: "Coming soon",
    confirm: "Confirm",
    confirmArchive: "Confirm archive",
    archive: "Archive",
    settingsAria: "Settings",
    showMore: "Show more",
    showLess: "Show less",
    projectActionAdd: "Add project",
    projectActionRename: "Rename project",
    projectActionRemove: "Remove project",
    projectActionCopyPath: "Copy path",
    projectActionArchive: "Archive project",
    projectActionDeleteThreads: "Delete all threads",
    intelOnArmTitle: "Intel build on Apple Silicon",
    sortProjects: "Sort projects",
    sortThreads: "Sort threads",
    sortRecentlyActive: "Recently active",
    sortRecentlyAdded: "Recently added",
    sortCreatedAt: "Created at",
    sortManual: "Manual",
    sortNewestFirst: "Newest first",
    projectSortMenuHeader: "Sort projects",
    threadSortMenuHeader: "Sort threads",
    pinThread: "Pin thread",
    unpinThread: "Unpin thread",
    addProjectError: "Unable to add project",
    newChatError: "Unable to start a new chat",
    openFolderError: "Unable to open folder picker",
    linkUnavailable: "Link opening is unavailable.",
    openPRError: "Unable to open PR link",
    openFinderError: "Unable to open in Finder",
    openTerminalError: "Unable to open terminal",
    removeProjectError: (name) => `Failed to remove "${name}"`,
    removeProjectSuccess: (name) => `Removed "${name}"`,
    thread: {
      pinError: (action) => (action === "pin" ? "Unable to pin thread" : "Unable to unpin thread"),
      renameError: "Failed to rename thread",
      renameEmpty: "Thread title cannot be empty",
      handoffError: "Could not create handoff thread",
      archiveRunningTitle: "Cannot archive",
      archiveRunningDescription: "Stop the running session before archiving this thread.",
      archiveEmpty: (projectName) => `"${projectName}" has no threads to archive.`,
      archiveFailedTitle: "Cannot archive threads",
      archiveSuccessOne: "Thread archived",
      archiveSuccessMany: (count) => `Archived ${count} threads`,
      archiveError: "Failed to archive threads",
      deleteEmpty: "Nothing to delete",
      deleteWorktreeWarning: "Thread deleted, but worktree removal failed",
      deleteSuccessOne: "Thread deleted",
      deleteSuccessMany: (count) => `Deleted ${count} threads`,
      deleteError: "Failed to delete threads",
      pathUnavailable: "Path unavailable",
      pathCopyUnavailable: "This thread does not have a workspace path to copy.",
      pathOpenUnavailable: "This thread does not have a workspace path to open.",
      copyThreadId: "Thread ID copied",
      copyThreadIdFailed: "Failed to copy thread ID",
      copyPath: "Path copied",
      copyPathFailed: "Failed to copy path",
    },
    files: {
      showFiles: "Show files",
      backToTasks: "Back to tasks",
      refresh: "Refresh file tree",
      searchLabel: "Search files",
      searchPlaceholder: "Search files…",
      clearSearch: "Clear file search",
      changedOnly: "Only show changed files",
      showAll: "Show all files",
      emptyDirectory: "This directory is empty.",
      loadingDirectory: "Loading files…",
      searching: "Searching…",
      noResults: "No matching files.",
      readFailed: "Failed to read this directory.",
      workspaceUnavailable: "This chat has no workspace folder to browse.",
      workspacePending: "The worktree for this chat is still being prepared.",
      changedFilesCount: (count) => (count === 1 ? "1 changed file" : `${count} changed files`),
      copyRelativePath: "Copy relative path",
      copyAbsolutePath: "Copy absolute path",
      copyPathFailed: "Failed to copy path",
      openInEditor: "Open in editor",
      openInEditorFailed: "Failed to open in editor",
      revealInFileManager: "Reveal in file manager",
      revealInFileManagerFailed: "Failed to reveal in file manager",
      statusModified: "Modified",
      statusAdded: "Added",
      statusDeleted: "Deleted",
      statusRenamed: "Renamed",
      statusUntracked: "Untracked",
      statusConflicted: "Conflicted",
      viewer: {
        browseFiles: "Browse files",
        closeTab: "Close tab",
        closePanel: "Close file panel",
        loading: "Loading file…",
        loadFailed: "Failed to read this file.",
        fileMissing: "This file no longer exists.",
        binary: "This file looks like binary data and cannot be previewed here.",
        tooLarge: "This file is too large to preview here. Open it in an editor instead.",
        empty: "This file is empty.",
        previewMode: "Preview",
        sourceMode: "Source",
        wrapLines: "Wrap lines",
        lineCount: (count) => (count === 1 ? "1 line" : `${count} lines`),
      },
    },
    update: {
      availableTitle: "Update available",
      availableDescription: (version) => `Peak Code ${version} is available.`,
      upToDateTitle: "You're up to date",
      upToDateDescription: (version) => `Peak Code ${version} is already the newest version.`,
      checkFailedTitle: "Could not check for updates",
      checkFailedDescription: "An unexpected error occurred.",
      downloadedTitle: "Update downloaded",
      downloadedDescription: "Restart the app to install the update.",
      downloadFailedTitle: "Could not download update",
      downloadFailedDescription: "Try again from the menu.",
      startFailedTitle: "Could not start update download",
      startFailedDescription: "The updater could not be started.",
      installFailedTitle: "Could not install update",
      installFailedDescription: "Restart the app manually to finish installing.",
      unexpectedError: "An unexpected error occurred.",
    },
    command: {
      newChat: {
        title: "New chat",
        description: "Open the new chat landing screen.",
      },
      newThread: {
        title: "New thread",
        description: "Start a fresh thread in the current project.",
      },
      addProject: {
        title: "Add project",
        description: "Open a repository or folder in the sidebar.",
      },
      attachSession: {
        title: "Attach session",
        description: "Attach a local thread to an existing provider session.",
      },
      openSettings: {
        title: "Open settings",
        description: "Open app settings.",
      },
    },
    deleteWorkspace: "Delete workspace",
  },
  searchPalette: {
    importHeading: "Import thread from provider",
    importDescription: "Create a local app thread and resume it from an existing provider id.",
    backAria: "Back to search",
    providerLabel: "Provider",
    noImportProviders: "No connected providers expose chat import in this build.",
    sessionIdLabel: "Session ID",
    sessionIdPlaceholder: "Paste a Pi session id",
    sessionIdHelp: "Pi resumes a persisted session by session id.",
    importAction: "Import",
    importing: "Importing...",
    importFailed: "Failed to import thread.",
    suggestedGroup: "Suggested",
    projectsGroup: "Projects",
    configureGroup: "Configure",
    darkThemesGroup: "Dark themes",
    lightThemesGroup: "Light themes",
    darkColorTheme: "Dark color theme",
    lightColorTheme: "Light color theme",
    followSystemTheme: "Follow system theme",
    followSystemThemeDescription: "Match your OS appearance setting.",
    switchToLightTheme: "Switch to light theme",
    switchToDarkTheme: "Switch to dark theme",
    lightThemeDescription: "Always use the light theme.",
    darkThemeDescription: "Always use the dark theme.",
    applyToLightSlot: "Apply to the current light theme slot.",
    applyToDarkSlot: "Apply to the current dark theme slot.",
    chatHits: (count) => `${count} chat hits`,
    chatMatch: "Chat match",
    projectMatch: "Project match",
    untitledThread: "Untitled thread",
    untitledProject: "Untitled project",
    noMatches: "No matches.",
    noMatchingFolders: "No matching folders.",
    inputHint: "Jump to threads, projects, actions, or appearance.",
    enterHint: "Enter to open",
    searchPlaceholder: "Search projects, threads, and actions",
    browsePlaceholder: "Enter project path (e.g. ~/projects/my-app)",
    add: "Add",
    createAndAdd: "Create & Add",
    addHighlightedFolder: (label, modifier) => `${label} highlighted folder (${modifier} Enter)`,
    addWithEnter: (label) => `${label} (Enter)`,
    addingProject: "Adding project...",
    browseHint: "Type a path, ↑↓ to navigate folders.",
    enterToGoUp: "Enter to go up",
    enterToAddProject: "Enter to add project",
    enterToOpenWithModifier: (modifier) => `Enter to open · ${modifier}+Enter to add`,
    createFolderHintPrefix: "Press Enter to create",
    createFolderHintSuffix: "and add it as a project.",
    errorEnterFolderPath: "Enter a folder path.",
    errorWindowsPath: "Windows paths are not supported on this platform.",
    errorRelativePath: "Relative paths are not supported. Use an absolute path or start with ~/.",
    errorAddProjectFallback: "Failed to add project.",
  },
  chat: {
    loadingModels: "Loading models",
    newChat: "New chat",
    handOff: "Hand off",
    run: "Run",
    stop: "Stop",
    share: "Share",
    compact: "Compact",
    plan: "Plan",
    planModeHint: "Plan mode — click to return to normal build mode",
    noActiveThread: "No active thread",
    selectOrCreate: "Select a thread or create a new one to get started.",
    clearUnavailable: "Clear is unavailable",
    clearUnavailableDescription: "Open a project before starting a fresh thread.",
    implementationFailed: "Could not start implementation thread",
    handoffError: "Could not create handoff thread",
    refreshProviderStatus: "Unable to refresh provider status",
    deletedAction: (name) => `Deleted action "${name ?? "Unknown"}"`,
    deleteActionFailed: "Could not delete action",
    updateAccessModeFailed: "Could not update access mode",
    tooManyAttachments: (max) => `You can attach up to ${max} references per message.`,
    browserAttachFailed: "Couldn't attach the in-app browser context",
    imagePreview: "Expanded image preview",
    imagePreviewClose: "Close image preview",
    imagePreviewPrev: "Previous image",
    imagePreviewNext: "Next image",
    attachImagesAfterPlan: "Attach images after answering plan questions.",
    voice: {
      authRequiredTitle: "Sign in to ChatGPT in Codex before using voice notes.",
      authRequiredDescription: "Voice notes require a ChatGPT-authenticated Codex session.",
      authSessionTitle: "Voice notes require a ChatGPT-authenticated Codex session.",
      authSessionDescription: "Sign in to ChatGPT again to record a voice note.",
      planUnansweredTitle: "Answer plan questions before recording a voice note.",
      planUnansweredDescription: "Plan questions must be answered before recording.",
      startFailedTitle: "Could not start recording",
      startFailedDescription: "Try again in a moment.",
      transcriptionUnavailableTitle: "Voice transcription is unavailable right now.",
      transcriptionUnavailableDescription: "Voice transcription is unavailable right now.",
      noAudioTitle: "No audio was captured.",
      noAudioDescription: "Try recording again.",
      transcribeFailedTitle: "Sign in to ChatGPT again",
      transcribeFailedDescription: "Couldn't transcribe voice note",
    },
    continueInNewWorktree: "Continue in a new worktree",
    reviewLocalChanges: "Review local uncommitted changes",
    reviewBranchDiff: "Review the current branch diff against its base",
    composerPlaceholder: (providerName) => `Message ${providerName}...`,
    stopGenerationAria: "Stop generation",
    stopGenerationTitle: "Stop the current response. On Mac, press Ctrl+C to interrupt.",
    implementationActionsAria: "Implementation actions",
    imagePlaceholder: (count) => `${count} image`,
    renameError: "Failed to rename thread",
    renameEmpty: "Thread title cannot be empty",
    timeline: {
      editMessage: "Edit message",
      editAndResend: "Edit and resend",
      revertLabel: "Revert to this message",
      revertTooltip: "Revert to this message",
      undoUnavailable: "Undo becomes available after a reply is checkpointed",
      emptyResponse: "(empty response)",
      response: "Response",
      responseWithSummary: (summary) => `Response • ${summary}`,
      showLess: "Show less",
      showMore: "Show more",
      showMoreCount: (count) => `Show ${count} more`,
      moreToolCalls: (count) => `+${count} more tool calls`,
      edited: "Edited",
      oneFileChanged: "1 File changed",
      filesChanged: (count) => `${count} Files changed`,
      collapseFiles: "Collapse changed files list",
      expandFiles: "Expand changed files list",
      undo: "Undo",
      workingFor: (duration) => `Working for ${duration}`,
      workingForPrefix: "Working for ",
      working: "Working...",
      emptyChat: "Send a message to start the conversation.",
      activityThinking: "Thinking",
      activityRead: "Reading",
      activityCommand: "Terminal",
      activityThinkingDuration: (duration) => `lasted ${duration}`,
      activityDurationSeconds: (seconds) => `${seconds}s`,
      activityDurationMinutes: (minutes, seconds) => `${minutes}m ${seconds}s`,
      activityReadSearchCount: (count) => (count === 1 ? "1 search" : `${count} searches`),
      activityReadFileCount: (count) => (count === 1 ? "1 file" : `${count} files`),
    },
    copy: {
      buttonAria: "Copy to clipboard",
      success: "Copied!",
      failed: "Failed to copy",
    },
  },
  chatEmptyState: {
    title: "Let's build",
    subtitle: "Start a new thread to begin.",
    whatShouldWeWorkOn: "What should we work on?",
    whatShouldWeDoIn: "What should we do in",
    thisFolder: "this folder",
  },
  chatHeader: {
    closeSidechat: "Close selected sidechat",
  },
  chatRoute: {
    loadingDiff: "Loading diff viewer...",
    splitPaneEmptyTitle: "Select a chat",
    splitPaneEmptyProject: "Project",
  },
  composer: {
    placeholder: "Ask anything, @tag files/folders, or use / to show available commands",
    placeholderApproval: "Resolve this approval request to continue",
    placeholderProgress: "Type your own answer, or leave this blank to use the selected option",
    placeholderPlan: "Add feedback to refine the plan, or leave this blank to implement it",
    placeholderFollowUp: "Ask for follow-up changes",
    placeholderDisconnected: "Ask for follow-up changes or attach images",
    moreAria: "More composer controls",
    extrasAria: "Composer extras",
    addImage: "Add image",
    pluginsLabel: "Plugins",
    pluginsHint: "Sent with this message",
    removePlugin: (name) => `Remove ${name}`,
    modeLabel: "Mode",
    buildLabel: "Build",
    planLabel: "Plan",
    localLabel: "Local",
    codexLabel: "Codex",
    interactionMode: {
      agentHint: "Direct execution: read, edit, run, test",
      planHint: "Research only — propose a plan before changing code",
      goalHint: "Locked objective, runs autonomously to acceptance",
      switchHint: (label) => `Click to switch to ${label}`,
      showPlanSidebar: "Show plan sidebar",
      hidePlanSidebar: "Hide plan sidebar",
    },
    removeImage: "Remove image",
    pendingApproval: "Pending approval",
    pendingUserInput: "Awaiting your input",
    cancelTurn: "Cancel turn",
    decline: "Decline",
    alwaysAllow: "Always allow this session",
    approveOnce: "Approve once",
    terminalContextExpired:
      "Terminal context expired. Remove and re-add the context to send this message.",
    voiceTranscribing: "Transcribing voice note",
    voiceStop: "Stop voice note",
    voiceRecord: "Record voice note",
    voiceHoldToRecord: "Hold to record",
    statusDialog: {
      local: "Local",
      worktree: "Worktree",
      newWorktreePending: "New worktree (pending)",
    },
    slashCommands: {
      local: "Local",
      worktree: "Worktree",
      plan: "Plan",
      newChat: "New chat",
    },
    contextWindowLabel: "Context window",
    contextWindowPercent: (percent) => `${percent}% used`,
    sendMessage: "Send message",
    sendingBusy: "Sending",
    sendingConnecting: "Connecting",
    sendingTranscribing: "Transcribing voice note",
    sendingPreparingWorktree: "Preparing worktree",
    steer: "Steer",
    deleteQueuedFollowUp: "Delete queued follow-up",
    queuedFollowUpActions: "Queued follow-up actions",
    queuedFollowUp: "Queued follow-up",
  },
  skills: {
    title: "Skills",
    subtitle: "Give Peak Code new superpowers.",
    newSkill: "New skill",
    browseSkillSh: "Browse skill.sh",
    searchPlaceholder: "Search skills",
    localHeading: "Installed on this machine",
    localCount: "{count} installed",
    localEmptyTitle: "No local skills found",
    localEmptyDescription:
      "Peak Code scanned ~/.claude/skills, ~/.codex/skills, and ~/.agents/skills. Drop a skill folder containing a SKILL.md into one of those directories, then refresh.",
    localEmptySearchTitle: "No local skills match this search",
    localEmptySearchDescription: "Try a different keyword or clear the search.",
    providerHeading: "Provided by model",
    providerHint: "Skills the active provider surfaces for this workspace.",
    installedHeading: "Skills",
    emptyTitle: "No skills found",
    emptyDescription: "This provider has no skills available in your workspace yet.",
    emptySearchTitle: "No skills match this search",
    emptySearchDescription: "Try a different keyword or clear the search to see all skills.",
    unavailableTitle: "Skills unavailable for {provider}",
    unavailableDescription: "This provider does not expose skill discovery.",
    needsWorkspace: "Skills need a workspace path. Open a project or thread first.",
    enableAria: (name) => `Enable or disable the ${name} skill`,
    enabledHint: "Listed to the agent every turn, and readable with read_skill.",
    disabledHint:
      "Hidden from the agent and refused by read_skill. The files stay on disk — turn it back on any time.",
  },
  plugins: {
    title: "Plugin marketplace",
    subtitle: "Extend Peak Code with skills, commands, and MCP capabilities.",
    searchPlaceholder: "Search plugins",
    installedHeading: "Installed",
    installedCount: "{count} installed",
    refresh: "Refresh",
    loading: "Loading plugins...",
    emptyTitle: "No plugins available",
    emptyDescription: "This provider does not expose any plugins for this workspace yet.",
    emptySearchTitle: "No plugins match this search",
    emptySearchDescription: "Try a different keyword, or clear the search to see everything.",
    unavailableTitle: "Plugins unavailable for {provider}",
    unavailableDescription: "This provider does not expose plugin discovery.",
    detailCapabilities: "Capabilities",
    detailSkills: "Skills it installs",
    detailExamples: "Example prompts",
    detailUse: "Use plugin",
    useFailedTitle: "Couldn’t use this plugin",
    useFailedDescription: "No chat is available to attach it to. Open a chat, then try again.",
    category: {
      productivity: "Productivity",
      "developer-tools": "Developer tools",
      utilities: "Utilities",
      automation: "Automation",
    },
  },
  automations: {
    subtitle: "A plan plus one instruction, running in the workspace you pick.",
    newAutomation: "New automation",
    emptyTitle: "Create your first automation",
    emptyDescription:
      "Describe what should happen on a schedule — an agent runs it in the workspace you choose and leaves the whole conversation behind.",
    noWorkspaceTitle: "Open a workspace first",
    noWorkspaceDescription:
      "Automations run inside a workspace so their runs know where to read and write.",
    loading: "Loading automations...",
    createTitle: "New automation",
    editTitle: "Edit automation",
    taskTitle: "Task name",
    taskTitlePlaceholder: "Daily briefing",
    instructions: "What should it do?",
    instructionsHint:
      "Nobody is around when this runs: name the files to read, the exact format you want, and where to write the result.",
    instructionsPlaceholder:
      "Summarise yesterday's commits into reports/daily.md and reply with the one thing I should look at first.",
    workspace: "Workspace",
    selectWorkspace: "Select a workspace",
    workspaceMissing: "This workspace is no longer available",
    plan: "Plan",
    planKinds: {
      once: "Once",
      daily: "Every day",
      weekly: "Every week",
    },
    onceAt: "Run at",
    time: "Time",
    weekdays: "Weekdays",
    weekdayLabels: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    timezone: "Timezone",
    mode: "Mode",
    modes: {
      default: "Agent",
      plan: "Plan",
      goal: "Goal",
    },
    create: "Create",
    save: "Save",
    cancel: "Cancel",
    creating: "Creating...",
    saving: "Saving...",
    createFailed: "Could not save the automation",
    runNow: "Run now",
    edit: "Edit",
    delete: "Delete",
    deleteConfirmTitle: "Delete this automation?",
    deleteConfirmDescription: "Its runs and their links to past conversations go with it.",
    enable: "Resume",
    disable: "Pause",
    disabled: "Paused",
    openConversation: "Open conversation",
    runsHeading: "Runs",
    noRuns: "No runs yet.",
    nextRun: "Next",
    noNextRun: "—",
    lastRun: "Last",
    never: "Never run",
    runStatus: {
      running: "Running",
      succeeded: "Succeeded",
      failed: "Failed",
      interrupted: "Interrupted",
    },
    triggerManual: "manual",
    scheduleDaily: (time) => `Every day ${time}`,
    scheduleWeekly: (days, time) => `Every week ${days} ${time}`,
    scheduleOnce: (at) => `Once · ${at}`,
    createdToast: "Automation created",
    savedToast: "Automation saved",
    deletedToast: "Automation deleted",
    runStartedToast: "Run started — it opens its own conversation",
    runFailedToast: "Could not start the run",
    chatHint: "You can also just ask in a chat: “every morning, summarise what changed here”.",
  },
  kanban: {
    subtitle: "Tasks stored with each project in .kanban/board.json.",
    project: "Project",
    selectProject: "Select project",
    addTask: "New task",
    newTask: "New task",
    editTask: "Edit task",
    taskTitle: "Task title",
    taskTitlePlaceholder: "What needs to be done?",
    taskDescription: "Requirements",
    taskDescriptionPlaceholder: "Context, acceptance criteria, references…",
    taskImages: "Images",
    addImage: "Add images",
    imageHint: "PNG, JPG, GIF… paste or drop, up to 8 images of 10MB each",
    removeImage: "Remove image",
    imageRejected: "Some files were not added — only images up to 10MB, 8 in total.",
    agent: "Agent",
    agentModel: "Model",
    defaultModel: "Default model",
    defaultModelWithName: (name) => `Default model (${name})`,
    agentRun: "Agent run",
    agentRunRunning: "Running",
    agentRunDone: "Done",
    agentRunFailed: "Failed",
    agentRunInterrupted: "Interrupted",
    agentRunUnknown: "Not started",
    openThread: "Open thread",
    priority: "Priority",
    status: "Status",
    pipeline: "Pipeline",
    pipelinePlaceholder: "e.g. Full-stack pipeline",
    assignee: "Assignee",
    assigneePlaceholder: "e.g. Full-stack dev",
    create: "Create",
    unsavedChangesConfirm: "You have unsaved changes. Leave without creating this task?",
    save: "Save",
    cancel: "Cancel",
    deleteTask: "Delete task",
    deleteTaskConfirm: "Delete this task?",
    noTasks: "No tasks",
    loading: "Loading board...",
    updatedLabel: "Updated",
    boardFileLabel: "Board file",
    filterAll: "All",
    searchPlaceholder: "Search tasks",
    clearSearch: "Clear search",
    viewBoard: "Board view",
    viewList: "List view",
    clearFilters: "Clear filters",
    noMatches: "No tasks match",
    noMatchesDescription: "Clear the filters to see the whole board again.",
    noMatchesColumn: "No matches",
    taskId: "Task id",
    unassigned: "Unassigned",
    showSidebar: "Show board menu",
    hideSidebar: "Hide board menu",
    addTaskIn: (column) => `New task in ${column}`,
    taskCount: (count) => (count === 1 ? "1 task" : `${count} tasks`),
    showingCount: (count) => (count === 1 ? "1 shown" : `${count} shown`),
    boardTab: "Board",
    listTab: "List",
    refreshBoard: "Refresh board",
    switchProject: "Switch project",
    backToAgents: "Back to agents",
    hiddenColumns: "Hidden columns",
    hiddenColumnsEmpty: "Every column is on the board.",
    columnActions: (column) => `Column actions for ${column}`,
    hideColumn: "Hide this column",
    showAllColumns: "Show all columns",
    revealColumn: (column) => `Show ${column} on the board`,
    createdLabel: "Created",
    sections: {
      projects: "Projects",
    },
    noProjectsTitle: "No projects yet",
    noProjectsDescription: "Kanban boards live inside a project directory, so add a project first.",
    columns: {
      todo: "To do",
      inProgress: "In progress",
      done: "Done",
      blocked: "Blocked",
      archived: "Archived",
    },
    priorities: {
      high: "High",
      medium: "Medium",
      low: "Low",
    },
    failure: {
      requirementTitle: "Could not generate the requirement",
      modelAccessDenied:
        "The model is not allowed for the configured key — pick a model the key can access, or check its permissions in Settings → Model providers.",
      authFailed:
        "The model credentials are missing or invalid — check the API key in Settings → Model providers.",
      modelNotFound: "The model was not found — check the model ID, or pick another model.",
      timeout: "The model took too long to answer — try again, or pick a faster model.",
      providerError:
        "The model provider returned an error — check the endpoint and network, then try again.",
      model: (model) => `model ${model}`,
    },
    detail: {
      back: "Board",
      requirement: "Requirements",
      requirementEmpty: "No requirements yet — write them here, or draft them from the title.",
      requirementAppendHint:
        "The requirement is the brief the task runs with; add to or correct it in the comments below.",
      requirementEditHint:
        "Rewriting replaces the brief the task runs with — the comments below are the place for additions.",
      editRequirement: "Edit",
      saveRequirement: "Save requirements",
      comments: "Comments",
      noComments: "No comments yet.",
      commentPlaceholder: "Add to the requirement, or leave a note for this task…",
      sendComment: "Comment",
      generateRequirement: "Generate",
      generatingRequirement: "Generating…",
      generateRequirementConfirm: "Replace the current requirements with a generated brief?",
      generateRequirementHint:
        "Draft an agile brief with acceptance criteria from the title and the requirements you wrote",
      steerComment: "Insert and interrupt",
      steerUnavailable: "Only available while the agent is running",
      interruptRun: "Interrupt run",
      authorAgent: "Agent",
      authorUser: "You",
      statusStarted: "Took the task and started working",
      statusDone: "Finished the work",
      statusFailed: "Blocked",
      statusInterrupted: "Run interrupted",
      statusSteered: "Comment inserted into the running turn",
      commentCount: (count) => (count === 1 ? "1 comment" : `${count} comments`),
      loading: "Loading task…",
      notFound: "This task no longer exists on the board.",
    },
  },
  settings: {
    title: "Settings",
    restoreDefaults: "Restore defaults",
    backToApp: "Back to app",
    nav: {
      general: {
        label: "General",
        description: "Default provider, thread mode, and sidebar organization.",
      },
      appearance: {
        label: "Appearance",
        description: "Theme, typography, and timestamp formatting.",
      },
      notifications: {
        label: "Notifications",
        description: "In-app toasts and desktop alerts.",
      },
      behavior: {
        label: "Behavior",
        description: "Streaming, diff handling, and destructive confirmations.",
      },
      skills: {
        label: "Skills",
        description: "Installed skills available to agents in this workspace.",
      },
      worktrees: {
        label: "Worktrees",
        description: "Review and clean up the worktrees created by Peak Code.",
      },
      archived: {
        label: "Archived",
        description: "View and restore archived threads.",
      },
      piPackages: {
        label: "Pi Packages",
        description: "Install pi packages from npm, git, or a local path.",
      },
      modelProviders: {
        label: "Model Providers",
        description: "Add and edit AI providers and models written to models.json.",
      },
      advanced: {
        label: "Advanced",
        description: "Keybindings, recovery, and version info.",
      },
      channels: {
        label: "Channels",
        description: "Drive the agent from WeChat, Feishu/Lark, QQ, or a webhook.",
      },
      usage: {
        label: "Usage",
        description: "Analyze the tokens every coding agent on this machine has consumed.",
      },
    },
    groups: {
      basics: "Basics",
      agent: "Agent",
      data: "Data & stats",
    },
    general: {
      heading: "General",
      description: "Default provider, thread mode, and sidebar organization.",
      coreDefaults: "Core defaults",
      sidebarOrganization: "Sidebar organization",
      language: {
        title: "Language",
        description: "Choose the language used in the Peak Code interface.",
        english: "English",
        chinese: "中文",
      },
      defaultProvider: {
        title: "Default provider",
        description: "Choose the provider used for new chats.",
        resetLabel: "default provider",
      },
      defaultModel: {
        title: "Default model",
        description:
          "The model a new chat starts on. A phone that paired by QR code has no composer history of its own, so it uses this one.",
        resetLabel: "default model",
        automatic: "First available model",
        automaticDescription:
          "No default is set: each new chat takes the first model the provider offers.",
      },
      newThreads: {
        title: "New threads",
        description: "Pick the default workspace mode for newly created draft threads.",
        resetLabel: "new threads",
        local: "Local",
        worktree: "New worktree",
      },
      sidebarPosition: {
        title: "Position",
        description: "Choose which side of the screen the sidebar appears on.",
        left: "Left",
        right: "Right",
        resetLabel: "sidebar position",
      },
      projectOrder: {
        title: "Project order",
        description: "Controls how projects are arranged in the main sidebar.",
        recentlyActive: "Recently active",
        recentlyAdded: "Recently added",
        manual: "Manual order",
        resetLabel: "project order",
      },
      threadOrder: {
        title: "Thread order",
        description: "Controls how threads are arranged inside each project in the main sidebar.",
        recentlyActive: "Recently active",
        newestFirst: "Newest first",
        resetLabel: "thread order",
      },
    },
    appearance: {
      heading: "Appearance",
      description: "Theme, typography, and timestamp formatting.",
      themeAndTypographySection: "Theme and typography",
      timeAndReadingSection: "Time and reading",
      theme: {
        title: "Theme",
        description: "Choose how Peak Code looks across the app.",
        system: "System",
        light: "Light",
        dark: "Dark",
        systemDescription: "Match your OS appearance setting.",
        lightDescription: "Always use the light theme.",
        darkDescription: "Always use the dark theme.",
      },
      lightThemeCard: {
        title: "Light theme",
        contextActive: "This is the active theme right now.",
        contextInactive: "Inactive while the app is locked to {mode}.",
        contextSystemActive: "System is currently using this light slot.",
        contextSystemInactive: "Used when your system switches to light.",
      },
      darkThemeCard: {
        title: "Dark theme",
        contextActive: "This is the active theme right now.",
        contextInactive: "Inactive while the app is locked to {mode}.",
        contextSystemActive: "System is currently using this dark slot.",
        contextSystemInactive: "Used when your system switches to dark.",
      },
      themePackReset: "Reset",
      themePackCopy: "Copy",
      themePackImport: "Import",
      themePackShareStringAria: "Theme share string",
      themePackCodeThemeAria: (label) => `${label} code theme`,
      themePackTranslucentAria: (label) => `${label} translucent sidebar`,
      themePackResetAria: (label) => `Reset ${label}`,
      themePackHexAria: (label) => `${label} hex value`,
      accent: "Accent",
      background: "Background",
      foreground: "Foreground",
      uiFontLabel: "UI font",
      codeFontLabel: "Code font",
      translucentSidebar: "Translucent sidebar",
      contrast: "Contrast",
      timestamp: {
        title: "Time format",
        description: "System default follows your browser or OS clock preference.",
        systemDefault: "System default",
        twelveHour: "12-hour",
        twentyFourHour: "24-hour",
        ariaLabel: "Timestamp format",
      },
      typography: {
        title: "Typography",
        description: "UI font, code font, and base size for the chat surface.",
        uiFont: "UI font",
        codeFont: "Code font",
        baseFontSize: "Base font size",
        fontSmoothing: "Font smoothing",
        uiFontDescription:
          "Set a custom font for the interface. Leave empty to use the active theme's UI font.",
        codeFontDescription:
          "Set a custom font for code blocks and inline code in chat. Leave empty to use the active theme's code font.",
        baseFontSizeDescription:
          "Adjust the app text base in pixels. Chat and UI typography scale proportionally from this value.",
        fontSmoothingDescription:
          "Use macOS-style antialiasing for lighter, crisper text rendering.",
        uiFontAria: "Custom UI font family",
        codeFontAria: "Custom chat code font family",
        baseFontSizeAria: "Base font size in pixels",
        fontSmoothingAria: "Enable font smoothing",
        unitPx: "px",
      },
    },
    notifications: {
      heading: "Notifications",
      description: "In-app toasts and desktop alerts.",
      activityAlertsSection: "Activity alerts",
      unavailableTitle: "Desktop notifications unavailable",
      supportBrowserBlocked:
        "Browser notifications are blocked. Open the site settings to enable them.",
      supportBrowserPrompt: "Browser will prompt for notification permission.",
      supportBrowserGranted: "Browser notifications are enabled.",
      supportDesktopUnsupported: "Desktop notifications are not supported on this device.",
      supportDesktopGranted: "Desktop notifications are enabled.",
      supportDesktopDenied: "Desktop notifications are blocked in your OS settings.",
      testTitle: "Activity notification",
      testBody: "Notification test for chats and terminal agents.",
      testSuccessTitle: "Test notification sent",
      testUnavailableTitle: "Notifications unavailable",
      testSuccessDescriptionDesktop: "Your operating system should show the notification.",
      testUnavailableDescriptionDesktop: "Desktop notifications are not supported on this device.",
      testSuccessDescriptionBrowser: "Your browser should show the notification.",
      testButton: "Test",
      activityToasts: {
        title: "Activity toasts",
        description:
          "Show an in-app toast when a chat or managed terminal agent finishes or needs input.",
        ariaLabel: "Activity toast notifications",
      },
      desktopNotifications: {
        title: "Desktop notifications",
        description:
          "Show an OS notification when a chat or managed terminal agent finishes or needs input while the app is in the background.",
        ariaLabel: "Desktop activity notifications",
      },
    },
    behavior: {
      heading: "Behavior",
      description: "Streaming, diff handling, and destructive confirmations.",
      runtimeSection: "Runtime behavior",
      safetySection: "Safety confirmations",
      assistantOutput: "Assistant output",
      assistantOutputDescription: "Show token-by-token output while a response is in progress.",
      assistantOutputAria: "Stream assistant messages",
      diffLineWrapping: "Diff line wrapping",
      diffLineWrappingDescription:
        "Set the default wrap state when the diff panel opens. The in-panel wrap toggle only affects the current diff session.",
      diffLineWrappingAria: "Wrap diff lines by default",
      deleteConfirmation: "Delete confirmation",
      deleteConfirmationDescription: "Ask before deleting a thread and its chat history.",
      deleteConfirmationAria: "Confirm thread deletion",
      archiveConfirmation: "Archive confirmation",
      archiveConfirmationDescription: "Ask before archiving a thread.",
      archiveConfirmationAria: "Confirm thread archive",
      terminalCloseConfirmation: "Terminal close confirmation",
      terminalCloseConfirmationDescription:
        "Ask before closing a terminal tab and clearing its history.",
      terminalCloseConfirmationAria: "Confirm terminal tab close",
    },
    worktrees: {
      heading: "Worktrees",
      description: "Review and clean up the worktrees created by Peak Code.",
      managedSection: "Managed worktrees",
      loading: "Loading managed worktrees...",
      loadFailedFallback: "Unable to load worktrees.",
      emptyState: "No app-managed worktrees found yet.",
      worktreeLabel: "Worktree",
      conversationsLabel: "Conversations",
      noConversations: "No conversations linked to this worktree.",
      deleteButton: "Delete",
      deleteWarning: "Linked conversations exist. Deleting will ask for confirmation.",
      verifyTitle: "Could not verify linked conversations",
      verifyDescription: "Retry once the app reconnects to the server.",
      deleteConfirmWithLinks: (name, count) =>
        `Permanently remove the worktree "${name}" and ${count} linked archived conversation${count === 1 ? "" : "s"}?`,
      deleteConfirm: (name) => `Permanently remove the worktree "${name}"?`,
      deleteAnyway: "Remove worktree",
      deleteLinkedActive: (active) => `${active} active`,
      deleteLinkedArchived: (archived) => `${archived} archived`,
      deleteArchivedWillDeleteFirst: "Archived conversations will be deleted first.",
      deleteLinkedWarning: "Deleting it can break reopening those chats in the same workspace.",
      deleteRemovesFromDisk: "This removes the Git worktree from disk.",
      deletedTitle: "Worktree deleted",
      deletedDescriptionWithArchived: (name, count) =>
        `${name} was removed and ${count} archived conversation${count === 1 ? "" : "s"} were deleted.`,
      deletedDescription: (name) => `${name} was removed.`,
      deleteErrorTitle: "Could not delete worktree",
      deleteErrorFallback: "Unable to delete the worktree.",
    },
    archived: {
      heading: "Archived",
      description: "View and restore archived threads.",
      emptySection: "Archived threads",
      emptyTitle: "No archived threads",
      emptyDescription: "Archived threads will appear here and can be restored to the sidebar.",
      unknownProject: "Unknown project",
      archivedAt: (when) => `Archived ${when}`,
      restoreButton: "Restore",
      deleteButton: "Delete",
      restoreTitle: "Thread restored",
      restoreDescription: "The thread has been moved back to the sidebar.",
      restoreErrorTitle: "Could not restore thread",
      restoreErrorFallback: "Unable to restore the thread.",
      deleteConfirm: (title) =>
        `Permanently delete "${title}"?\n\nThis will remove the thread and its conversation history forever.`,
      deleteTitle: "Thread deleted",
      deleteDescription: "The archived thread has been permanently removed.",
      deleteErrorTitle: "Could not delete thread",
      deleteErrorFallback: "Unable to delete the thread.",
      contextMenuRestore: "Restore",
      contextMenuDelete: "Delete",
    },
    models: {
      heading: "Models",
      description: "Git writing defaults and custom model slugs.",
      generationSection: "Generation defaults",
      customSection: "Custom models",
      gitWritingModel: "Git writing model",
      gitWritingModelDescription:
        "Used for generated commit messages, PR titles, and branch names.",
      gitWritingModelAria: "Git text generation model",
      customModelEmpty: "Enter a model slug.",
      customModelBuiltIn: "That model is already built in.",
      customModelTooLong: (max) => `Model slugs must be ${max} characters or less.`,
      customModelDuplicate: "That custom model is already saved.",
      customModelResetLabel: "custom models",
      customAddPlaceholder: "Add a custom model slug",
      customAddButton: "Add",
      customAddAria: "Add custom model",
      customProviderAria: "Custom model provider",
      customRemoveAria: (slug) => `Remove ${slug}`,
      customShowLess: "Show less",
      customShowMore: (count) => `Show more (${count})`,
      savedModelSlugs: "Saved model slugs",
      savedModelSlugsDescription: "Add custom model slugs for supported providers.",
    },
    providers: {
      heading: "Providers",
      description: "Choose visible providers, review CLI installs, and update provider tools.",
      updatesSection: "Updates",
      pickerSection: "Provider picker",
      toolsSection: "Provider tools",
      installTitle: (providerName) => `${providerName} installation`,
      visibility: {
        title: "Visible providers",
        description:
          "Drag providers into your preferred picker order and hide the ones you don't use. The provider you're currently using on a thread always stays visible.",
        statusAllVisible: "All providers visible",
        statusCustomOrder: "Custom order",
        statusHidden: (count) => `${count} providers hidden`,
        statusHiddenOne: "1 provider hidden",
        showAria: (name) => `Show ${name} in the provider picker`,
        reorderAria: (name) => `Reorder ${name}`,
        resetLabel: "provider picker",
      },
      updates: {
        title: "Provider updates",
        description: "Update installed provider tools that Peak Code can safely update.",
        statusNoUpdates: "No provider updates detected",
        statusAvailableOne: "1 update available",
        statusAvailableMany: (count) => `${count} updates available`,
        statusAvailablePlural: (count) => `${count} updates available`,
        manualUpdate: "Manual update",
        updateButton: "Update",
        updatingButton: "Updating",
        commandLabel: "Command: ",
        runCommandTitle: (command) => `Run ${command}`,
        versionAdvisoryNoCommand:
          "A newer version is available, but Peak Code could not identify a safe one-click update command for this installation.",
      },
      tools: {
        title: "Installed CLIs",
        description:
          "Review provider versions and update tools. Open a row only when you need binary overrides.",
        statusNoUpdates: "No provider updates detected",
        statusAvailableOne: "1 update available",
        statusAvailableMany: (count) => `${count} updates available`,
        statusAvailablePlural: (count) => `${count} updates available`,
        customBadge: "Custom",
        resetLabel: "provider tools",
        binaryPathLabel: (providerName) => `${providerName} binary path`,
        homePathLabel: "CODEX_HOME path",
        homePathDescription: "Optional custom Codex home and config directory.",
        agentDirLabel: "Pi agent directory",
        agentDirDescription:
          "Optional custom Pi agent directory for auth, models, skills, and commands.",
        apiEndpointLabel: "Cursor API endpoint",
        apiEndpointDescription:
          "Optional Cursor API endpoint override passed to `cursor-agent -e`.",
        serverUrlLabel: (providerName) => `${providerName} server URL`,
        serverUrlDescription: (providerName) =>
          `Optional existing ${providerName} server URL. Leave blank to spawn a local server.`,
        serverPasswordLabel: (providerName) => `${providerName} server password`,
        serverPasswordDescription: (providerName) =>
          `Optional password for an externally managed ${providerName} server.`,
        binaryPathDescription: (command) => `Leave blank to use \`${command}\` from your PATH.`,
        binaryPathPlaceholder: (providerName) => `${providerName} binary path`,
        homePathPlaceholder: "CODEX_HOME",
        agentDirPlaceholder: "Pi agent directory",
        apiEndpointPlaceholder: "https://api2.cursor.sh",
        serverUrlPlaceholder: "http://127.0.0.1:4096",
        serverPasswordPlaceholder: (providerName) => `${providerName} server password`,
      },
      docs: {
        install: "Install",
        update: "Update",
        config: "Config",
        headless: "Headless",
        label: "CLI docs",
      },
      update: {
        queued: "Update queued",
        updating: "Updating",
        updated: "Updated",
        failed: "Update failed",
        stillOutdated: "Still outdated",
        versionDelta: (current, latest) => `${current} -> ${latest}`,
        latest: (version) => `Latest ${version}`,
        current: (version) => `Current ${version}`,
        errorFallback: "The provider update did not complete.",
      },
      cliDocs: "CLI docs",
    },
    modelProviders: {
      heading: "Model Providers",
      description:
        "Configure AI providers (OpenAI, DeepSeek, Ollama, …) and their models. Saving writes models.json and refreshes the model picker.",
      filePathLabel: "Config file",
      builtinHint:
        "Pi already ships common providers (OpenAI, Anthropic, Google, MiniMax). Only add a provider here when you need custom endpoints or extra models.",
      emptyTitle: "No providers configured",
      emptyDescription: "Add a provider from a known template, or write a custom one.",
      builtinGroupLabel: "Built-in",
      customGroupLabel: "Custom providers",
      loadFailedTitle: "Could not load model providers",
      loadFailedFallback:
        "This can happen when models.json is malformed. Fix the file manually, then reload.",
      addButton: "Add provider",
      addDialogTitle: "Add model provider",
      templateLabel: "Template",
      templateAria: "Provider template",
      templateCustom: "Custom provider",
      providerExistsHint: (name) =>
        `${name} already exists; it will be updated instead of duplicated.`,
      providerKeyLabel: "Provider key",
      providerNameLabel: "Display name",
      providerApiLabel: "API type",
      providerBaseUrlLabel: "Base URL",
      providerApiKeyLabel: "API key",
      providerApiKeyHint:
        "A plain value is saved as a secret in Pi's credential store, not in the config file. Use $ENV_VAR, ${ENV_VAR} or !shell commands (e.g. !op read …) to keep a reference in the config file instead.",
      providerApiKeyPlaceholder: (env) => `Secret key, or a reference such as $${env}`,
      providerStoredKeyHint:
        "A key is saved in Pi's credential store. It is never shown again — type a new one to replace it.",
      providerClearKeyButton: "Forget saved key",
      providerModelsLabel: "Models",
      modelAddButton: "Add model",
      modelFetchButton: "Fetch model list",
      remoteModelsTitle: (provider) => `${provider} · available models`,
      remoteModelsLoading: "Fetching the provider's model list…",
      remoteModelsFailed: "Could not read the provider's model list.",
      remoteModelsSummary: (total, missing) =>
        `${total} models returned · ${missing} not added yet`,
      remoteModelsSearchPlaceholder: "Search model id",
      remoteModelsEmpty: "The provider returned no models.",
      remoteModelsNoMatch: "No model matches the current filter.",
      remoteModelsAdd: "Add",
      remoteModelsAdded: "Added",
      remoteModelsAddAria: (id) => `Add model ${id}`,
      remoteModelsAddAll: "Add all",
      remoteModelsAddGroup: "Add group",
      remoteModelsGroupOther: "Other",
      remoteModelsAddedCount: (count) => `${count} already added`,
      modelCategoryAll: "All",
      modelCategories: {
        chat: "Chat",
        embedding: "Embedding",
        rerank: "Rerank",
        tts: "Speech",
        asr: "Transcribe",
        image: "Image",
        video: "Video",
        music: "Music",
        other: "Other",
      },
      modelIdLabel: "Model ID",
      modelIdPlaceholder: "Model ID",
      modelContextLabel: "Context window",
      modelContextBadge: (value) => `Context ${value}`,
      modelMaxTokensLabel: "Max output tokens",
      modelMaxTokensBadge: (value) => `Output ${value}`,
      modelInputTypesLabel: "Input types",
      modelOutputTypesLabel: "Output types",
      inputTypes: {
        text: "Text",
        image: "Image",
        video: "Video",
        pdf: "PDF",
      },
      modelAddTitle: "Add model",
      modelEditTitle: "Edit model",
      modelSaveButton: "Save",
      modelEditAria: (id) => `Edit ${id}`,
      modelRemoveAria: (id) => `Remove model ${id}`,
      providerRemoveAria: (name) => `Remove provider ${name}`,
      providerRemoveConfirm: (name) =>
        `Remove provider ${name}? This cannot be undone until you save.`,
      saveButton: "Save changes",
      savingButton: "Saving…",
      savedTitle: "Model providers saved",
      testButton: "Test connection",
      testHint:
        "Sends a short request to the first configured model (or the first built-in model). May use a small amount of API credit.",
      testAutoSaveHint:
        "Unsaved changes will be saved, then the connection test runs. May use a small amount of API credit.",
      enableButton: "Enable",
      enableSavingButton: "Enabling…",
      enabledStatus: "Enabled",
      disabledStatus: "Un-enabled",
      enablePaneTitle: (name) => `Enable ${name}`,
      enablePaneHint:
        "Paste an API key for this provider and hit Enable. It will be saved to models.json and a connection test will run. Un-enabled providers are kept out of the config until you enable them.",
      testResults: {
        success: "Connection successful",
        "invalid-config": "Pi could not load the model configuration. Check models.json.",
        "model-not-found": "No matching model found. Add a model first.",
        "auth-missing":
          "Credentials could not be resolved. Check your API key or environment variable.",
        timeout: "Connection timed out after 20 seconds.",
        "request-failed":
          "Request failed. Check the endpoint, credentials, model access, and network.",
      },
      unsavedHint: "You have unsaved changes.",
      cancelButton: "Cancel",
    },
    channels: {
      heading: "Channels",
      description:
        "Wire a chat app to this workspace: a message sent there opens a thread, and the agent's answer is sent back into the chat.",
      names: {
        wechat: "WeChat (personal)",
        feishu: "Feishu / Lark",
        qq: "QQ bot",
        wecom: "WeCom app",
        wechatMp: "Official account",
        webhook: "Webhooks",
      },
      status: {
        connected: "Connected",
        connecting: "Connecting…",
        off: "Off",
        failed: "Failed",
        notConfigured: "Not configured",
      },
      actions: {
        save: "Save",
        saving: "Saving…",
        saved: "Saved",
        edit: "Edit",
        test: "Test connection",
        testing: "Testing…",
        disconnect: "Disconnect",
        forget: "Forget chat",
        refresh: "Refresh",
      },
      wechat: {
        title: "WeChat · personal account",
        description:
          "Scan the code with WeChat and then message the linked account: messages are long-polled from your machine, so no public address is needed.",
        scan: "Scan to link WeChat",
        rescan: "Scan again with another account",
        scanHint: "Scan with WeChat, then send a message to the linked account.",
        waiting: "Waiting for the phone…",
        scanned: "Scanned — confirm on your phone",
        expired: "The code expired — ask for a new one",
        confirmed: "Linked",
        disconnectConfirm: "Disconnect WeChat? The linked account stops receiving answers.",
      },
      feishu: {
        title: "Feishu / Lark",
        description:
          "Create a custom app on the open platform, add the bot capability and the im:message scopes, then subscribe to message events over the long connection. No public address needed.",
        domain: "Platform",
        domainFeishu: "Feishu (China)",
        domainLark: "Lark (international)",
        appId: "App ID",
        appSecret: "App Secret",
        secretPlaceholder: "Leave empty to keep the stored secret",
      },
      qq: {
        title: "QQ bot",
        description:
          "An official-platform bot app: enable message lists, then paste its AppID/AppSecret. Long connection, no public address.",
        appId: "App ID",
        appSecret: "App Secret",
      },
      wecom: {
        title: "WeCom · self-built app",
        description:
          "Callback mode: Tencent has to reach this server, so a public HTTPS address is required.",
        callbackHint: "Callback URL",
        corpId: "Corp ID",
        agentId: "Agent ID",
        secret: "Secret",
        callbackToken: "Callback Token",
        encodingAesKey: "EncodingAESKey",
      },
      wechatMp: {
        title: "WeChat official account",
        description:
          "Callback mode: answers are pushed with customer-service messages, which needs a verified account and a public HTTPS address.",
        callbackHint: "Callback URL",
        appId: "App ID",
        appSecret: "App Secret",
        callbackToken: "Token",
        encodingAesKey: "EncodingAESKey",
      },
      webhooks: {
        title: "Webhooks",
        description:
          "Group robots announce finished work (push only). The inbound bridge lets any tool that can send HTTP run a task.",
        wecomUrl: "WeCom group robot URL",
        dingtalkUrl: "DingTalk robot URL",
        dingtalkSecret: "DingTalk sign secret",
        inboundSecret: "Inbound bridge secret",
        taskHint: "POST /api/im/task with { message, session, secret }",
      },
      behavior: {
        title: "How IM runs work",
        description: "Where IM threads open and how much freedom they get.",
        project: "Workspace",
        projectAuto: "Most recently used project",
        idleHours: "Idle reset (hours)",
        idleHoursHint:
          "After this long without a message the chat starts a fresh thread. 0 keeps one context forever.",
        runtimeMode: "Permission mode",
        modeApproval: "Approval required",
        modeFull: "Full access",
        runtimeModeHint:
          "Nobody is at the keyboard during an IM run, so approvals would wait forever. Full access is an explicit choice — file protections still apply.",
      },
      conversations: {
        title: "Linked chats",
        description:
          "Each chat keeps its own thread; forgetting one starts over on the next message.",
        empty: "No chat has talked to this workspace yet.",
        forget: "Forget",
      },
      log: {
        title: "Recent traffic",
        empty: "Nothing has crossed the bridge yet.",
        incoming: "In",
        outgoing: "Out",
        error: "Error",
      },
      mobile: {
        title: "Mobile remote control",
        description:
          "Scan the code with a phone to control this machine from it, or hand it to a chat bot for longer sessions.",
        phoneTitle: "Connect a phone",
        phoneDescription:
          "The phone opens a remote control for this computer: what is running here, and the conversation you can pick up. Everything still runs on this machine.",
        waiting: "Waiting for the phone",
        ready: "Ready",
        stop: "Stop",
        refresh: "New code",
        copyLink: "Copy link",
        copied: "Link copied",
        linkHint: "Cannot scan? Open the link on the phone instead.",
        botTitle: "Use a chat bot",
        botDescription: "Connect a bot for access that outlasts a one-off link.",
        openSettings: "Configure in Channels",
        manageTitle: "Bot management",
        manageDescription: "Chats currently wired to a thread in this workspace.",
        manageEmpty: "No chat is connected yet.",
        loadFailed: "Could not reach the IM bridge.",
        sidebarTooltip: "Mobile & IM channels",
        opensThread: (title) => `The phone opens “${title}”`,
        opensProject: (project) => `The phone starts a new chat in ${project}`,
        defaultModelSet: (model) => `New chats on the phone use ${model}`,
        defaultModelUnset:
          "No default model is set, so the phone takes the first model available — set one in Settings → General.",
      },
      remote: {
        title: "Cloudflare remote access",
        description:
          "Publish this workspace on a temporary Cloudflare address so a phone can reach it from any network — no port forwarding, no public IP.",
        start: "Start Cloudflare tunnel",
        starting: "Opening tunnel…",
        stop: "Stop tunnel",
        connected: "Tunnel live",
        connecting: "Opening…",
        off: "Tunnel off",
        failed: "Tunnel failed",
        urlLabel: "Public address",
        copy: "Copy address",
        copied: "Address copied",
        publicWarning:
          "The address is public: whoever has it still has to pair (one-time link, expiring session), but treat it as exposed while it runs.",
        needsToken:
          "This server has no access token, so it refuses to publish itself. Restart Peak Code with --auth-token <token> (the desktop app always has one) and try again.",
        autoStart: "Open the tunnel on startup",
        autoStartHint: "Keeps the QR code working after a restart.",
        binaryPath: "cloudflared path",
        binaryPathHint: "Defaults to cloudflared from PATH (macOS: brew install cloudflared).",
        lastUrl: "Last address",
        openHint: "Scan the code below to open this workspace on the phone.",
      },
    },
    usage: {
      badge: "Local usage",
      scope: (days) =>
        `Counts the local session records of every coding agent on this machine, last ${days} days.`,
      refresh: "Refresh",
      loading: "Reading local usage logs…",
      errorTitle: "Could not load usage statistics",
      emptyTitle: "No usage recorded yet",
      emptyDescription:
        "Run a session in any coding agent on this machine and its token usage shows up here.",
      generatedAt: (time) => `Updated ${time}`,
      filter: {
        label: "Tool",
        all: "All tools",
      },
      stats: {
        cumulativeTokens: "Total tokens",
        peakTokens: "Peak day",
        longestChat: "Longest chat",
        currentStreak: "Current streak",
        longestStreak: "Longest streak",
      },
      mix: {
        title: "Token mix",
        input: "Input",
        output: "Output",
        cacheRead: "Cache read",
        cacheWrite: "Cache write",
      },
      tools: {
        title: "Tool usage",
        description: "Every tool's share of this machine's tokens.",
        inactive: "No records found",
        sessions: (count) => `${count} sessions`,
        models: (count) => `${count} models`,
        lastUsed: (time) => `Last used ${time}`,
      },
      activity: {
        title: "Token activity",
        daily: "Daily",
        weekly: "Weekly",
        cumulative: "Cumulative",
        tokensUnit: "tokens",
        responses: (count) => `${count} ${count === "1" ? "response" : "responses"}`,
        weekTotal: (tokens) => `Week ${tokens} tokens`,
        cumulativeTotal: (tokens) => `Running total ${tokens} tokens`,
      },
      range: {
        label: "Time range",
        last7: "Last 7 days",
        last30: "Last 30 days",
      },
      trend: {
        title: "Daily token trend",
      },
      models: {
        title: "Model usage",
        other: "Other",
      },
      sessions: {
        title: "Recent sessions",
        project: "Project",
        duration: "Duration",
        requests: "Requests",
        requestCount: (count) => `${count} req`,
        detail: "Requests",
        detailTitle: "Session requests",
        detailEmpty: "This session has no request rows to show.",
        dropped: (count) => `Showing the most recent requests; ${count} older ones were released.`,
        unavailable: "Request detail for this session has been released.",
        time: "Time",
        model: "Model",
        input: "Input",
        output: "Output",
        cache: "Cache r/w",
        total: "Total",
        close: "Close",
      },
    },
    piPackages: {
      heading: "Pi Packages",
      description:
        "Packages bundle extensions, skills, prompt templates, and themes. Installing records the source in settings.json; new threads load it automatically.",
      settingsPathLabel: "Recorded in",
      sourceLabel: "Package source",
      sourcePlaceholder: "npm:@scope/pkg or git:host/user/repo",
      sourceHint:
        "npm sources install through your global npm prefix; git sources clone into the pi agent directory. A local path is referenced in place.",
      installButton: "Install",
      installingButton: "Installing…",
      loadingLabel: "Reading installed packages…",
      loadFailedTitle: "Could not load pi packages",
      loadFailedFallback: "Check that the pi agent directory is readable.",
      emptyTitle: "No packages installed",
      emptyDescription:
        "Install a package to add extensions, skills, or prompt templates to every thread.",
      projectScopeLabel: "project",
      filteredLabel: "resources disabled",
      notInstalledLabel: "Not on disk yet — installed on the next session start.",
      reloadHint:
        "Extensions load when a session starts. In an open thread, run /reload to pick up a new package.",
      resources: {
        skills: "skills",
        prompts: "prompts",
        extensions: "extensions",
        themes: "themes",
      },
      removeConfirm: (source) => `Uninstall ${source} and remove it from settings?`,
      removeAria: (source) => `Uninstall ${source}`,
    },
    advanced: {
      heading: "Advanced",
      description: "Keybindings, recovery, and version info.",
      developerSection: "Developer tools",
      aboutSection: "About",
      keybindings: {
        title: "Keybindings",
        description:
          "Open the persisted `keybindings.json` file to edit advanced bindings directly.",
        pathPlaceholder: "Resolving keybindings path...",
        openEditorHint: "Opens in your preferred editor.",
        openButton: "Open file",
        openingButton: "Opening...",
        noEditor: "No available editors found.",
        openError: "Unable to open keybindings file.",
        noEditorToast: "No available editors found.",
        openErrorFallback: "Unable to open keybindings file.",
        openErrorUnknown: "Unable to open keybindings file.",
      },
      recovery: {
        title: "Recovery tools",
        description:
          "Rebuild local project indexes without clearing existing chats when the local state gets out of sync.",
        offerReason: "Visible because projects exist but no chat history is currently available.",
        hiddenReason: "Shown automatically only when recovery actions are relevant.",
        whatThisDoesLabel: "What this does",
        whatThisDoesBody:
          "Rebuilds local project indexes and refreshes project snapshots. Existing chats stay in place.",
        repairButton: "Repair state",
        repairingButton: "Repairing...",
        confirmTitle: "Repair local state?",
        confirmDescription: "This rebuilds local project indexes and refreshes project snapshots.",
        confirmSpacer: "It keeps existing chats in place, but it may take a moment.",
        successTitle: "Local state repaired",
        successDescription: "Project indexes were rebuilt without clearing existing chats.",
        errorTitle: "Repair failed",
        errorFallback: "Unable to repair local state.",
      },
      version: {
        title: "Version",
        description: "Current application version.",
      },
    },
    changedSettingLabel: {
      theme: "Theme",
      darkThemePack: "Dark theme pack",
      lightThemePack: "Light theme pack",
      defaultProvider: "Default provider",
      defaultModel: "Default model",
      newThreadMode: "New thread mode",
      sidebarPosition: "Sidebar position",
      projectSortOrder: "Project sort order",
      threadSortOrder: "Thread sort order",
      uiFont: "UI font",
      codeFont: "Code font",
      baseFontSize: "Base font size",
      fontSmoothing: "Font smoothing",
      timeFormat: "Time format",
      activityToasts: "Activity toasts",
      desktopNotifications: "Desktop notifications",
      assistantOutput: "Assistant output",
      diffLineWrapping: "Diff line wrapping",
      deleteConfirmation: "Delete confirmation",
      archiveConfirmation: "Archive confirmation",
      terminalCloseConfirmation: "Terminal close confirmation",
      gitWritingModel: "Git writing model",
      customModels: "Custom models",
      providerInstalls: "Provider installs",
      providerVisibility: "Provider visibility",
      providerOrder: "Provider order",
      language: "Language",
    },
    resetAria: (label) => `Reset ${label} to default`,
    resetTooltip: "Reset to default",
    restoreDefaultsConfirm: (labels) => `Restore default settings?\nThis will reset: ${labels}.`,
    themePack: {
      importTitle: "Import theme pack",
      importDescription: "Paste a shared theme pack string to apply it instantly.",
      apply: "Apply",
      reset: "Reset",
    },
  },
  dialog: {
    confirm: {
      deleteThread: (title) =>
        `"${title}"\n\nThis will permanently delete the thread and its history.`,
      deleteThreadPermanent: "Delete thread",
      archiveThread: "Archive thread",
      removeProject: (name) => `Remove "${name}" from the sidebar?`,
      removeProjectAndThreads: (name, count) =>
        `Remove "${name}" from the sidebar and delete ${count} thread${count === 1 ? "" : "s"}?`,
      cancel: "Cancel",
      continue: "Delete",
      discardDraft: "Discard the new thread draft?",
    },
    rename: {
      title: "Rename chat",
      description: "Keep it short and recognizable.",
      submit: "Rename",
      cancel: "Cancel",
    },
    pullRequest: {
      title: "Link pull request",
      description: "Paste a GitHub pull request URL or number to attach to this thread.",
      placeholder: "https://github.com/owner/repo/pull/42 or #42",
      open: "Open",
      cancel: "Cancel",
    },
    worktreeHandoff: {
      title: "Hand off to worktree",
      description:
        "Move the running session into a new worktree so you can keep working without losing context.",
      submit: "Hand off",
      cancel: "Cancel",
    },
  },
  whatsNew: {
    title: "What's new",
    popoutTitle: "What's new in Peak Code",
    open: "Open",
    dismiss: "Dismiss",
    gotIt: "Got it",
    releaseNotes: "Release notes",
    readMore: "Read more",
    showLess: "Show less",
    highlights: "Highlights",
    allReleases: "All releases",
    versionLabel: (version) => `v${version}`,
  },
  taskCompletion: {
    markAllRead: "Mark all as read",
    viewChat: "View chat",
  },
  workspace: {
    fallbackTitle: "Workspace",
    renameHint: "Double-click to rename",
    terminalTab: "Terminal",
    settingsAria: "Workspace settings",
    loading: "Loading workspace",
    emptyTitle: "No workspace open",
    openInEditor: "Open in editor",
  },
  terminal: {
    findPlaceholder: "Find",
    matchCase: "Match case",
    tabTerminal: "Terminal",
    tabChat: "Chat",
  },
  gitActions: {
    groupAria: "Git actions",
    optionsAria: "Git action options",
    prTitlePlaceholder: "Leave empty to auto-generate",
    linkUnavailable: "Link opening is unavailable.",
    noOpenPR: "No open PR found.",
    openPRErrorTitle: "Unable to open PR link",
    syncingTitle: "Syncing with remote...",
    syncSuccess: "Remote synced",
    alreadyUpToDate: "Already up to date",
    syncFailed: "Sync failed",
    createPRUnavailable: "Create PR unavailable",
    noChanges: "No branch changes to include in a PR.",
    running: "Running git action...",
    waiting: "Waiting for Git...",
    keeping: (name) => `Keeping ${name}`,
    branchConfirmed: "Branch name confirmed.",
    creatingBranch: "Creating branch...",
    switchedTo: (name) => `Switched to ${name}`,
    createdCheckedOut: "Branch created and checked out.",
    createFailed: "Failed to create branch",
    editorUnavailable: "Editor opening is unavailable.",
    openFileFailed: "Unable to open file",
  },
  browser: {
    screenshotCopied: "Browser screenshot copied",
    urlPlaceholder: "Search or enter a URL",
    actionsAria: "Browser actions",
  },
  branchToolbar: {
    newWorktree: "New worktree",
    handoffNewWorktree: "Hand off to new worktree",
    handoffLocal: "Hand off to local",
    rateLimitsRemaining: "Rate limits remaining",
    checkoutPR: "Checkout Pull Request",
    searchPlaceholder: "Search branches...",
    createTitle: "Create Branch",
    discardStash: "Discard saved stash?",
    loadingStash: "Loading stash details...",
    fieldBranch: "Branch",
    fieldWorktree: "Worktree",
    fieldStash: "Stash",
    fieldName: "Name",
  },
  projectScripts: {
    groupAria: "Project scripts",
    actionAria: "Script actions",
    editAria: (name) => `Edit ${name}`,
    nameLabel: "Name",
    chooseIcon: "Choose icon",
    testPlaceholder: "Test",
    keybindingLabel: "Keybinding",
    pressShortcut: "Press shortcut",
    pressShortcutHint: "Press a shortcut. Use Backspace to clear.",
    commandLabel: "Command",
    autoRunLabel: "Run automatically on worktree creation",
    deleteConfirmDescription: "This action cannot be undone.",
    addScript: "Add script",
    delete: "Delete",
    deleteConfirmTitle: (name) => `Delete action "${name}"?`,
    deleteAction: "Delete action",
  },
  themeEditor: {
    copiedTitle: "Theme copied",
    copiedDescription: (variant) => `Copied the ${variant} theme share string.`,
    copyFailedTitle: "Copy failed",
    copyFailedDescription: "Unable to copy the theme share string.",
    codeAria: (label) => `${label} code theme`,
    systemDefault: "System default",
    translucentSidebar: "Translucent sidebar",
    translucentSidebarAria: (label) => `${label} translucent sidebar`,
    resetAria: (label) => `Reset ${label}`,
    resetTitle: "Reset to default",
    hexValueAria: (label) => `${label} hex value`,
    importedTitle: "Theme imported",
    importedDescription: (variant) => `Updated the ${variant} theme pack.`,
    shareStringAria: "Theme share string",
    background: "Background",
    text: "Text",
    accent: "Accent",
    border: "Border",
    status: "Status",
    code: "Code",
    light: "Light",
    dark: "Dark",
    reset: "Reset",
    shareString: "Share string",
    apply: "Apply",
    import: "Import",
    foreground: "Foreground",
    uiFont: "UI font",
    codeFont: "Code font",
    codeFontPlaceholder: '"JetBrains Mono"',
    contrast: "Contrast",
    contextActiveSystem: (variant) => `System is currently using this ${variant} slot.`,
    contextActiveLocked: "This is the active theme right now.",
    contextInactiveSystem: (variant) => `Used when your system switches to ${variant}.`,
    contextInactiveLocked: (mode) => `Inactive while the app is locked to ${mode}.`,
    importDialogTitle: (variant) => `Import ${variant} theme`,
    importDialogDescription: (variant) =>
      `Paste a codex-theme-v1: share string. The embedded variant must match ${variant}, and the selected code theme must exist for that variant.`,
    importDialogCancel: "Cancel",
    importDialogSubmit: "Import",
    importError: "Unable to import that theme string.",
    importPlaceholder: 'codex-theme-v1:{"codeThemeId":"linear",...}',
    copy: "Copy",
  },
  themePack: {
    importTitle: "Import theme pack",
    importDescription: "Paste a shared theme pack string to apply it instantly.",
    apply: "Apply",
    reset: "Reset",
  },
  restoreDefaults: {
    title: "Restore defaults",
    description: (labels) => `Restore default settings?\nThis will reset: ${labels}.`,
    button: "Restore",
  },
  keybindings: {
    searchPlaceholder: "Search shortcuts...",
    title: "Keyboard shortcuts",
  },
  rateLimits: {
    reachedTitle: "Rate limit reached.",
    approachingTitle: "Approaching rate limit",
    planLimitTitle: "Plan limit reached",
    noData: "No rate limit data yet.",
  },
  providerUsage: {
    title: (providerName) => `${providerName} usage`,
    fallbackTitle: "Usage",
    window: "Window",
    resetsAt: "Resets at",
    noData: "No usage data yet.",
  },
  debug: {
    actionFailed: "Action failed",
    fallback: "An error occurred.",
  },
  notification: {
    retention: {
      title: "Cleaning old chats...",
      preparing: "Preparing background cleanup.",
      progress: (purged, total) => `${purged} of ${total} chats removed.`,
      progressSimple: (purged) => `${purged} chats removed.`,
      compactingTitle: "Compacting chat database...",
      compactingReclaim: "Reclaiming unused database space.",
      compactingFinishing: "Finishing cleanup.",
      pausedTitle: "Cleanup paused",
      pausedDescription: "Old chats will be retried later.",
      successTitle: "Old chats cleaned",
      successDescription: (purged) => `${purged} chats removed from the database.`,
      successDescriptionEmpty: "No old chats needed cleanup.",
    },
    providerUpdate: {
      title: (providerName) => `Updating ${providerName}.`,
      titleMany: (count) => `Updating ${count} providers.`,
      description: (providerName) => `Updating ${providerName}.`,
      descriptionMany: (count) => `Updating ${count} providers.`,
      errorFallback: "The update command did not complete successfully.",
      stillOutdated: "The provider still appears outdated after updating.",
      requestFailed: "The update request failed.",
      failedTitleAll: "Provider updates failed",
      failedTitleSome: "Some provider updates failed",
      successTitleOne: (providerName) => `${providerName} updated`,
      successTitleMany: (count) => `${count} providers updated`,
      successDescription: "New sessions will use the refreshed provider tools.",
      availableTitleOne: (providerName) => `${providerName} update available`,
      availableTitleMany: (count) => `${count} provider updates available`,
      availableDescriptionOne: (providerName) => `${providerName} has a newer version available.`,
      availableDescriptionMany: (providerName, count) =>
        `${providerName} and ${count} more provider${count === 1 ? "" : "s"} have newer versions available.`,
      actionReview: "Review updates",
      actionUpdateAll: "Update all",
    },
    keybindings: {
      invalidTitle: "Invalid keybindings configuration",
      openConfigAction: "Open keybindings.json",
      noEditor: "No available editors found.",
      openFileErrorTitle: "Unable to open keybindings file",
      openFileErrorFallback: "Unknown error opening file.",
    },
  },
};

const zh: Messages = {
  common: {
    cancel: "取消",
    save: "保存",
    delete: "删除",
    confirm: "确认",
    retry: "重试",
    close: "关闭",
    open: "打开",
    ok: "好的",
    done: "完成",
    loading: "加载中…",
    yes: "是",
    no: "否",
    errorOccurred: "发生错误。",
    unexpectedError: "发生意外错误。",
    unsavedChangesConfirm: "还有未保存的内容，确定丢弃吗？",
  },
  appShell: {
    connecting: "正在连接 {name} 服务器…",
  },
  remoteControl: {
    title: "Peak Code 远程控制",
    connected: "已连接到当前桌面窗口",
    connecting: "正在连接桌面端…",
    disconnected: "未连接",
    disconnectedHint:
      "这个页面控制的是已经打开的 Peak Code 桌面端。二维码失效或桌面端关闭后，请回到桌面端点击手机图标重新扫码。",
    notice:
      "本次连接可以查看当前设备上已打开的工作区和任务，你在这里发送的内容仍然在这台电脑上执行。链接是一次性的，失效后需要回到桌面端重新连接。",
    sectionTitle: "当前设备上的工作区和任务",
    counts: (workspaces, tasks) => `${workspaces} 个工作区 · ${tasks} 个任务`,
    bucket: {
      today: "今天",
      yesterday: "昨天",
      earlier: "更早",
    },
    empty: "这台电脑上还没有任务。",
    retry: "重试连接",
    refresh: "刷新",
    back: "返回",
    noMessages: "还没有消息。",
    composerPlaceholder: "继续这个对话…",
    send: "发送",
    sending: "发送中…",
    stop: "停止",
    approve: "允许",
    deny: "拒绝",
    approvalTitle: "等待你的确认",
    status: {
      running: "运行中",
      waiting: "待确认",
      completed: "已完成",
      failed: "失败",
      interrupted: "已中断",
      idle: "空闲",
    },
  },
  appNavigation: {
    back: "后退",
    backMac: "后退（⌘[）",
    backWin: "后退（Alt+←）",
    forward: "前进",
    forwardMac: "前进（⌘]）",
    forwardWin: "前进（Alt+→）",
  },
  errorFallback: {
    title: "出错了。",
    retry: "重试",
    reload: "重新加载应用",
    showDetails: "显示错误详情",
    hideDetails: "隐藏错误详情",
    unexpected: "发生意外路由错误。",
    noDetails: "没有更多可用的错误信息。",
  },
  splash: {
    retry: "重试",
  },
  sidebar: {
    brandLabel: "Peak",
    newChat: "新建会话",
    newDisposableTooltip: "新建一次性会话",
    search: "搜索",
    threads: "线程",
    workspace: "工作区",
    recent: "最近",
    settings: "设置",
    addProject: "添加项目",
    noProjectsYet: "暂无项目",
    noProjectsYetDescription: "选择一个本地项目文件夹来开始第一个线程。",
    chooseProjectFolder: "选择项目文件夹",
    openingFolderPicker: "正在打开...",
    addingProject: "正在添加...",
    loadingProjects: "正在加载项目",
    toggleSidebar: "切换线程侧边栏",
    codeLabel: "代码",
    disposableChat: "一次性聊天",
    pendingApproval: "待审批",
    pluginsLabel: "插件",
    automationsLabel: "自动化",
    kanbanLabel: "看板",
    automationsComingSoon: "即将推出",
    confirm: "确认",
    confirmArchive: "确认归档",
    archive: "归档",
    settingsAria: "设置",
    showMore: "展开更多",
    showLess: "收起",
    projectActionAdd: "添加项目",
    projectActionRename: "重命名项目",
    projectActionRemove: "移除项目",
    projectActionCopyPath: "复制路径",
    projectActionArchive: "归档项目",
    projectActionDeleteThreads: "删除所有线程",
    intelOnArmTitle: "Apple Silicon 上的 Intel 构建",
    sortProjects: "项目排序",
    sortThreads: "线程排序",
    sortRecentlyActive: "最近活跃",
    sortRecentlyAdded: "最近添加",
    sortCreatedAt: "创建时间",
    sortManual: "手动",
    sortNewestFirst: "最新优先",
    projectSortMenuHeader: "项目排序",
    threadSortMenuHeader: "线程排序",
    pinThread: "置顶线程",
    unpinThread: "取消置顶",
    addProjectError: "无法添加项目",
    newChatError: "无法新建会话",
    openFolderError: "无法打开文件夹选择器",
    linkUnavailable: "链接打开不可用。",
    openPRError: "无法打开 PR 链接",
    openFinderError: "无法在访达中打开",
    openTerminalError: "无法打开终端",
    removeProjectError: (name) => `移除「${name}」失败`,
    removeProjectSuccess: (name) => `已移除「${name}」`,
    thread: {
      pinError: (action) => (action === "pin" ? "无法置顶线程" : "无法取消置顶"),
      renameError: "重命名线程失败",
      renameEmpty: "线程标题不能为空",
      handoffError: "无法创建交接线程",
      archiveRunningTitle: "无法归档",
      archiveRunningDescription: "请先停止正在运行的会话，再归档此线程。",
      archiveEmpty: (projectName) => `「${projectName}」没有可归档的线程。`,
      archiveFailedTitle: "无法归档线程",
      archiveSuccessOne: "线程已归档",
      archiveSuccessMany: (count) => `已归档 ${count} 个线程`,
      archiveError: "归档线程失败",
      deleteEmpty: "没有可删除的内容",
      deleteWorktreeWarning: "线程已删除，但工作树清理失败",
      deleteSuccessOne: "线程已删除",
      deleteSuccessMany: (count) => `已删除 ${count} 个线程`,
      deleteError: "删除线程失败",
      pathUnavailable: "路径不可用",
      pathCopyUnavailable: "此线程没有可复制的工作区路径。",
      pathOpenUnavailable: "此线程没有可打开的工作区路径。",
      copyThreadId: "线程 ID 已复制",
      copyThreadIdFailed: "复制线程 ID 失败",
      copyPath: "路径已复制",
      copyPathFailed: "复制路径失败",
    },
    files: {
      showFiles: "查看文件",
      backToTasks: "返回任务",
      refresh: "刷新文件树",
      searchLabel: "搜索文件",
      searchPlaceholder: "搜索文件...",
      clearSearch: "清空文件搜索",
      changedOnly: "仅显示变更文件",
      showAll: "显示全部文件",
      emptyDirectory: "当前目录为空。",
      loadingDirectory: "正在读取文件列表...",
      searching: "正在搜索...",
      noResults: "没有匹配的文件。",
      readFailed: "读取目录失败。",
      workspaceUnavailable: "该任务没有可浏览的工作区目录。",
      workspacePending: "该任务的工作树尚在准备中。",
      changedFilesCount: (count) => `${count} 个变更文件`,
      copyRelativePath: "复制相对路径",
      copyAbsolutePath: "复制绝对路径",
      copyPathFailed: "复制路径失败",
      openInEditor: "在编辑器中打开",
      openInEditorFailed: "无法在编辑器中打开",
      revealInFileManager: "在文件管理器中显示",
      revealInFileManagerFailed: "无法在文件管理器中显示",
      statusModified: "已修改",
      statusAdded: "已新增",
      statusDeleted: "已删除",
      statusRenamed: "已重命名",
      statusUntracked: "未跟踪",
      statusConflicted: "有冲突",
      viewer: {
        browseFiles: "浏览文件",
        closeTab: "关闭标签页",
        closePanel: "关闭文件面板",
        loading: "正在读取文件...",
        loadFailed: "读取文件失败。",
        fileMissing: "该文件已不存在。",
        binary: "当前文件看起来像二进制内容，暂不支持预览。",
        tooLarge: "文件过大，无法在此预览。请使用编辑器打开。",
        empty: "文件为空",
        previewMode: "预览",
        sourceMode: "源码",
        wrapLines: "自动换行",
        lineCount: (count) => `${count} 行`,
      },
    },
    update: {
      availableTitle: "有新版本可用",
      availableDescription: (version) => `Peak Code ${version} 已可更新。`,
      upToDateTitle: "已是最新版本",
      upToDateDescription: (version) => `Peak Code ${version} 已是最新版本。`,
      checkFailedTitle: "无法检查更新",
      checkFailedDescription: "发生意外错误。",
      downloadedTitle: "更新已下载",
      downloadedDescription: "重启应用以安装更新。",
      downloadFailedTitle: "无法下载更新",
      downloadFailedDescription: "请在菜单中重试。",
      startFailedTitle: "无法启动更新下载",
      startFailedDescription: "更新器无法启动。",
      installFailedTitle: "无法安装更新",
      installFailedDescription: "请手动重启应用以完成安装。",
      unexpectedError: "发生意外错误。",
    },
    command: {
      newChat: {
        title: "新建聊天",
        description: "打开新聊天着陆页。",
      },
      newThread: {
        title: "新建线程",
        description: "在当前项目中开启一个全新线程。",
      },
      addProject: {
        title: "添加项目",
        description: "在侧边栏打开一个仓库或文件夹。",
      },
      attachSession: {
        title: "挂接会话",
        description: "将本地线程挂接到现有的提供方会话。",
      },
      openSettings: {
        title: "打开设置",
        description: "打开应用设置。",
      },
    },
    deleteWorkspace: "删除工作区",
  },
  searchPalette: {
    importHeading: "从提供方导入线程",
    importDescription: "创建一个本地应用线程，并从现有提供方 id 恢复它。",
    backAria: "返回搜索",
    providerLabel: "提供方",
    noImportProviders: "当前构建中没有可导入聊天的已连接提供方。",
    sessionIdLabel: "会话 ID",
    sessionIdPlaceholder: "粘贴 Pi 会话 id",
    sessionIdHelp: "Pi 通过会话 id 恢复已持久化的会话。",
    importAction: "导入",
    importing: "导入中…",
    importFailed: "导入线程失败。",
    suggestedGroup: "推荐",
    projectsGroup: "项目",
    configureGroup: "配置",
    darkThemesGroup: "深色主题",
    lightThemesGroup: "浅色主题",
    darkColorTheme: "深色配色主题",
    lightColorTheme: "浅色配色主题",
    followSystemTheme: "跟随系统主题",
    followSystemThemeDescription: "匹配操作系统的外观设置。",
    switchToLightTheme: "切换到浅色主题",
    switchToDarkTheme: "切换到深色主题",
    lightThemeDescription: "始终使用浅色主题。",
    darkThemeDescription: "始终使用深色主题。",
    applyToLightSlot: "应用到当前浅色主题槽位。",
    applyToDarkSlot: "应用到当前深色主题槽位。",
    chatHits: (count) => `${count} 条聊天命中`,
    chatMatch: "聊天命中",
    projectMatch: "项目命中",
    untitledThread: "未命名线程",
    untitledProject: "未命名项目",
    noMatches: "没有匹配结果。",
    noMatchingFolders: "没有匹配的文件夹。",
    inputHint: "跳转到线程、项目、操作或外观设置。",
    enterHint: "回车打开",
    searchPlaceholder: "搜索项目、线程和操作",
    browsePlaceholder: "输入项目路径（例如 ~/projects/my-app）",
    add: "添加",
    createAndAdd: "创建并添加",
    addHighlightedFolder: (label, modifier) => `${label}高亮的文件夹（${modifier}+回车）`,
    addWithEnter: (label) => `${label}（回车）`,
    addingProject: "正在添加项目…",
    browseHint: "输入路径，↑↓ 浏览文件夹。",
    enterToGoUp: "回车返回上一级",
    enterToAddProject: "回车添加项目",
    enterToOpenWithModifier: (modifier) => `回车打开 · ${modifier}+回车添加`,
    createFolderHintPrefix: "按回车创建",
    createFolderHintSuffix: "并添加为项目。",
    errorEnterFolderPath: "请输入文件夹路径。",
    errorWindowsPath: "当前平台不支持 Windows 路径。",
    errorRelativePath: "不支持相对路径。请使用绝对路径或以 ~/ 开头。",
    errorAddProjectFallback: "添加项目失败。",
  },
  chat: {
    loadingModels: "正在加载模型",
    newChat: "新建聊天",
    handOff: "交接",
    run: "运行",
    stop: "停止",
    share: "分享",
    compact: "压缩",
    plan: "计划",
    planModeHint: "计划模式 — 点击切回常规构建模式",
    noActiveThread: "暂无活跃线程",
    selectOrCreate: "请选择一个线程或新建一个以开始。",
    clearUnavailable: "无法清空",
    clearUnavailableDescription: "请先打开一个项目，再开始新线程。",
    implementationFailed: "无法启动实施线程",
    handoffError: "无法创建交接线程",
    refreshProviderStatus: "无法刷新提供方状态",
    deletedAction: (name) => `已删除操作「${name ?? "未知"}」`,
    deleteActionFailed: "无法删除操作",
    updateAccessModeFailed: "无法更新访问模式",
    tooManyAttachments: (max) => `每条消息最多附加 ${max} 个引用。`,
    browserAttachFailed: "无法附加应用内浏览器上下文",
    imagePreview: "展开的图片预览",
    imagePreviewClose: "关闭图片预览",
    imagePreviewPrev: "上一张",
    imagePreviewNext: "下一张",
    attachImagesAfterPlan: "请在回答完计划问题后再附加图片。",
    voice: {
      authRequiredTitle: "请先在 Codex 中登录 ChatGPT 再使用语音。",
      authRequiredDescription: "语音功能需要已登录 ChatGPT 的 Codex 会话。",
      authSessionTitle: "语音功能需要已登录 ChatGPT 的 Codex 会话。",
      authSessionDescription: "请重新登录 ChatGPT 后再录制语音。",
      planUnansweredTitle: "请先回答计划问题再录制语音。",
      planUnansweredDescription: "必须在回答计划问题后才能录制。",
      startFailedTitle: "无法开始录制",
      startFailedDescription: "请稍后再试。",
      transcriptionUnavailableTitle: "当前语音转写不可用。",
      transcriptionUnavailableDescription: "当前语音转写不可用。",
      noAudioTitle: "未捕获到音频。",
      noAudioDescription: "请重新录制。",
      transcribeFailedTitle: "请重新登录 ChatGPT",
      transcribeFailedDescription: "无法转写语音备注",
    },
    continueInNewWorktree: "在新工作树中继续",
    reviewLocalChanges: "查看本地未提交的变更",
    reviewBranchDiff: "查看当前分支相对基线的 diff",
    composerPlaceholder: (providerName) => `向 ${providerName} 发送消息…`,
    stopGenerationAria: "停止生成",
    stopGenerationTitle: "停止当前回复。在 Mac 上，按 Ctrl+C 中断。",
    implementationActionsAria: "实施操作",
    imagePlaceholder: (count) => `${count} 张图片`,
    renameError: "重命名线程失败",
    renameEmpty: "线程标题不能为空",
    timeline: {
      editMessage: "编辑消息",
      editAndResend: "编辑并重新发送",
      revertLabel: "回滚到此消息",
      revertTooltip: "回滚到此消息",
      undoUnavailable: "回复被确认后才能撤销",
      emptyResponse: "（空回复）",
      response: "回复",
      responseWithSummary: (summary) => `回复 • ${summary}`,
      showLess: "收起",
      showMore: "展开更多",
      showMoreCount: (count) => `展开剩余 ${count} 个`,
      moreToolCalls: (count) => `+${count} 个更多工具调用`,
      edited: "已编辑",
      oneFileChanged: "1 个文件已更改",
      filesChanged: (count) => `${count} 个文件已更改`,
      collapseFiles: "折叠变更文件列表",
      expandFiles: "展开变更文件列表",
      undo: "撤销",
      workingFor: (duration) => `已工作 ${duration}`,
      workingForPrefix: "已工作 ",
      working: "处理中…",
      emptyChat: "发送一条消息以开始对话。",
      activityThinking: "思考",
      activityRead: "查阅",
      activityCommand: "终端",
      activityThinkingDuration: (duration) => `持续了 ${duration}`,
      activityDurationSeconds: (seconds) => `${seconds} 秒`,
      activityDurationMinutes: (minutes, seconds) => `${minutes} 分 ${seconds} 秒`,
      activityReadSearchCount: (count) => `${count} 搜索`,
      activityReadFileCount: (count) => `${count} 文件`,
    },
    copy: {
      buttonAria: "复制到剪贴板",
      success: "已复制！",
      failed: "复制失败",
    },
  },
  chatEmptyState: {
    title: "开始构建",
    subtitle: "新建一个线程以开始。",
    whatShouldWeWorkOn: "我们一起做点什么？",
    whatShouldWeDoIn: "在",
    thisFolder: "此文件夹",
  },
  chatHeader: {
    closeSidechat: "关闭所选旁聊",
  },
  chatRoute: {
    loadingDiff: "正在加载 diff 视图…",
    splitPaneEmptyTitle: "选择一个聊天",
    splitPaneEmptyProject: "项目",
  },
  composer: {
    placeholder: "输入任何内容，使用 @ 引用文件/文件夹，或使用 / 查看可用命令",
    placeholderApproval: "请先处理此授权请求再继续",
    placeholderProgress: "输入你自己的答案，或留空使用所选选项",
    placeholderPlan: "添加反馈以优化计划，或留空以执行",
    placeholderFollowUp: "请求后续修改",
    placeholderDisconnected: "请求后续修改或附加图片",
    moreAria: "更多输入控制",
    extrasAria: "输入扩展",
    addImage: "添加图片",
    pluginsLabel: "插件",
    pluginsHint: "随本条消息一起发送",
    removePlugin: (name) => `移除 ${name}`,
    modeLabel: "模式",
    buildLabel: "构建",
    planLabel: "计划",
    localLabel: "本地",
    codexLabel: "Codex",
    interactionMode: {
      agentHint: "直接动手：读改跑测一条龙",
      planHint: "只调研不出手，先给方案",
      goalHint: "锁定目标，自主走到验收",
      switchHint: (label) => `点击切换到 ${label}`,
      showPlanSidebar: "显示计划侧边栏",
      hidePlanSidebar: "隐藏计划侧边栏",
    },
    removeImage: "移除图片",
    pendingApproval: "待审批",
    pendingUserInput: "等待你的输入",
    cancelTurn: "取消回合",
    decline: "拒绝",
    alwaysAllow: "本会话始终允许",
    approveOnce: "本次允许",
    terminalContextExpired: "终端上下文已过期。请移除并重新添加该上下文后再发送。",
    voiceTranscribing: "正在转写语音",
    voiceStop: "停止语音",
    voiceRecord: "录制语音",
    voiceHoldToRecord: "按住录制",
    statusDialog: {
      local: "本地",
      worktree: "工作树",
      newWorktreePending: "新建工作树（待处理）",
    },
    slashCommands: {
      local: "本地",
      worktree: "工作树",
      plan: "计划",
      newChat: "新建聊天",
    },
    contextWindowLabel: "上下文窗口",
    contextWindowPercent: (percent) => `已使用 ${percent}%`,
    sendMessage: "发送消息",
    sendingBusy: "发送中",
    sendingConnecting: "连接中",
    sendingTranscribing: "正在转写语音",
    sendingPreparingWorktree: "正在准备工作树",
    steer: "引导",
    deleteQueuedFollowUp: "删除排队的追问",
    queuedFollowUpActions: "排队追问操作",
    queuedFollowUp: "排队的追问",
  },
  skills: {
    title: "技能",
    subtitle: "赋予 Peak Code 更强大的能力。",
    newSkill: "新技能",
    browseSkillSh: "浏览 skill.sh",
    searchPlaceholder: "搜索技能",
    localHeading: "本机已安装",
    localCount: "{count} 个已安装",
    localEmptyTitle: "未发现本机技能",
    localEmptyDescription:
      "Peak Code 已扫描 ~/.claude/skills、~/.codex/skills 与 ~/.agents/skills。把一个含 SKILL.md 的技能目录放进任一目录后刷新即可。",
    localEmptySearchTitle: "没有匹配的本机技能",
    localEmptySearchDescription: "尝试其他关键词，或清空搜索。",
    providerHeading: "由模型提供",
    providerHint: "当前工作区下，当前模型暴露的技能。",
    installedHeading: "技能",
    emptyTitle: "未找到技能",
    emptyDescription: "当前工作区还没有可用的技能。",
    emptySearchTitle: "没有匹配此搜索的技能",
    emptySearchDescription: "尝试其他关键词，或清空搜索查看全部技能。",
    unavailableTitle: "{provider} 暂不支持技能",
    unavailableDescription: "该模型未开放技能发现能力。",
    needsWorkspace: "技能需要工作区路径。请先打开项目或会话。",
    enableAria: (name) => `启用或停用技能 ${name}`,
    enabledHint: "每轮都会列给模型，可以用 read_skill 读正文。",
    disabledHint: "不再列给模型，read_skill 也会拒绝读取。文件仍保留在磁盘上，随时可以再打开。",
  },
  plugins: {
    title: "插件市场",
    subtitle: "用插件为 Peak Code 扩展技能、命令与 MCP 能力。",
    searchPlaceholder: "搜索插件",
    installedHeading: "已安装",
    installedCount: "已安装 {count} 个",
    refresh: "刷新",
    loading: "加载插件…",
    emptyTitle: "暂无可用插件",
    emptyDescription: "当前模型还没有为这个工作区提供插件。",
    emptySearchTitle: "没有匹配此搜索的插件",
    emptySearchDescription: "尝试其他关键词，或清空搜索查看全部插件。",
    unavailableTitle: "{provider} 暂不支持插件",
    unavailableDescription: "该模型未开放插件发现能力。",
    detailCapabilities: "能力",
    detailSkills: "包含的技能",
    detailExamples: "示例指令",
    detailUse: "立即使用",
    useFailedTitle: "无法使用该插件",
    useFailedDescription: "当前没有可以附加的会话，请先打开一个会话再试一次。",
    category: {
      productivity: "生产力",
      "developer-tools": "开发者工具",
      utilities: "实用工具",
      automation: "自动化",
    },
  },
  automations: {
    subtitle: "一个计划 + 一句话 + 一个工作区，到点在那个工作区里跑一轮。",
    newAutomation: "新建自动化",
    emptyTitle: "创建第一个自动化",
    emptyDescription:
      "描述一下到点要做什么 —— 智能体会在你选的工作区里跑一轮，并把整条会话留下来。",
    noWorkspaceTitle: "请先打开一个工作区",
    noWorkspaceDescription: "自动化在某个工作区里运行，这样它才知道该在哪里读、在哪里写。",
    loading: "加载自动化…",
    createTitle: "新建自动化",
    editTitle: "编辑自动化",
    taskTitle: "任务名",
    taskTitlePlaceholder: "每日简报",
    instructions: "要它做什么？",
    instructionsHint: "跑的时候没人在旁边补话：把要读的文件、要什么格式、结果写到哪里都写清楚。",
    instructionsPlaceholder:
      "汇总工作区里昨天的提交，整理成一页写入 reports/daily.md，最后用一句话说明今天最需要我注意的事。",
    workspace: "工作区",
    selectWorkspace: "选择工作区",
    workspaceMissing: "这个工作区已不可用",
    plan: "计划",
    planKinds: {
      once: "仅一次",
      daily: "每天",
      weekly: "每周",
    },
    onceAt: "执行时间",
    time: "时间",
    weekdays: "星期",
    weekdayLabels: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
    timezone: "时区",
    mode: "模式",
    modes: {
      default: "Agent",
      plan: "Plan",
      goal: "Goal",
    },
    create: "创建",
    save: "保存",
    cancel: "取消",
    creating: "创建中…",
    saving: "保存中…",
    createFailed: "无法保存自动化",
    runNow: "立即运行",
    edit: "编辑",
    delete: "删除",
    deleteConfirmTitle: "删除这个自动化？",
    deleteConfirmDescription: "它的运行记录，以及这些记录指向的历史会话入口，会一并删除。",
    enable: "恢复",
    disable: "暂停",
    disabled: "已暂停",
    openConversation: "打开会话",
    runsHeading: "运行记录",
    noRuns: "还没跑过。",
    nextRun: "下次",
    noNextRun: "—",
    lastRun: "上次",
    never: "还没跑过",
    runStatus: {
      running: "运行中",
      succeeded: "成功",
      failed: "失败",
      interrupted: "已中断",
    },
    triggerManual: "手动",
    scheduleDaily: (time) => `每天 ${time}`,
    scheduleWeekly: (days, time) => `每周 ${days} ${time}`,
    scheduleOnce: (at) => `仅一次 · ${at}`,
    createdToast: "自动化已创建",
    savedToast: "自动化已保存",
    deletedToast: "自动化已删除",
    runStartedToast: "已开始运行 —— 它会开一条自己的会话",
    runFailedToast: "无法开始运行",
    chatHint: "也可以在对话里直接说：「每天早上帮我汇总一下这里的改动」。",
  },
  kanban: {
    subtitle: "任务随项目存放于 .kanban/board.json，智能体与界面读写同一份文件。",
    project: "项目",
    selectProject: "选择项目",
    addTask: "新增任务",
    newTask: "新增任务",
    editTask: "编辑任务",
    taskTitle: "任务标题",
    taskTitlePlaceholder: "要做什么？",
    taskDescription: "需求描述",
    taskDescriptionPlaceholder: "补充背景、验收标准、参考链接…",
    taskImages: "图片",
    addImage: "添加图片",
    imageHint: "支持 PNG/JPG/GIF 等，可粘贴或拖入，最多 8 张、单张 ≤ 10MB",
    removeImage: "移除图片",
    imageRejected: "部分文件未添加：仅支持图片，单张 ≤ 10MB，最多 8 张。",
    agent: "智能体",
    agentModel: "模型",
    defaultModel: "默认模型",
    defaultModelWithName: (name) => `默认模型（${name}）`,
    agentRun: "智能体执行",
    agentRunRunning: "执行中",
    agentRunDone: "已完成",
    agentRunFailed: "执行失败",
    agentRunInterrupted: "已中断",
    agentRunUnknown: "尚未执行",
    openThread: "打开会话",
    priority: "优先级",
    status: "状态",
    pipeline: "流水线",
    pipelinePlaceholder: "例如：全栈开发流水线",
    assignee: "负责人",
    assigneePlaceholder: "例如：全栈开发",
    create: "创建",
    unsavedChangesConfirm: "还有未保存的内容，确定离开且不创建任务吗？",
    save: "保存",
    cancel: "取消",
    deleteTask: "删除任务",
    deleteTaskConfirm: "确定删除这个任务？",
    noTasks: "暂无数据",
    loading: "正在加载看板…",
    updatedLabel: "更新于",
    boardFileLabel: "看板文件",
    filterAll: "全部",
    searchPlaceholder: "搜索任务",
    clearSearch: "清除搜索",
    viewBoard: "看板视图",
    viewList: "列表视图",
    clearFilters: "清除筛选",
    noMatches: "没有符合条件的任务",
    noMatchesDescription: "清除筛选条件即可看到全部任务。",
    noMatchesColumn: "无匹配",
    taskId: "任务 ID",
    unassigned: "未指派",
    showSidebar: "显示看板菜单",
    hideSidebar: "隐藏看板菜单",
    addTaskIn: (column) => `在「${column}」新建任务`,
    taskCount: (count) => `共 ${count} 个任务`,
    showingCount: (count) => `显示 ${count} 条`,
    boardTab: "看板",
    listTab: "列表",
    refreshBoard: "刷新看板",
    switchProject: "切换项目",
    backToAgents: "返回智能体",
    hiddenColumns: "隐藏列",
    hiddenColumnsEmpty: "所有列都已在看板上。",
    columnActions: (column) => `「${column}」列操作`,
    hideColumn: "隐藏该列",
    showAllColumns: "显示全部列",
    revealColumn: (column) => `在板上显示「${column}」`,
    createdLabel: "创建于",
    sections: {
      projects: "项目",
    },
    noProjectsTitle: "还没有项目",
    noProjectsDescription: "看板挂在项目目录上，请先在应用里添加一个项目。",
    columns: {
      todo: "待开始",
      inProgress: "进行中",
      done: "已完成",
      blocked: "已阻塞",
      archived: "归档",
    },
    priorities: {
      high: "高",
      medium: "中",
      low: "低",
    },
    failure: {
      requirementTitle: "需求生成失败",
      modelAccessDenied:
        "当前模型没有访问权限：换一个该 Key 可用的模型，或在「设置 → 模型提供商」里检查授权。",
      authFailed: "模型凭证无效或缺失：请在「设置 → 模型提供商」里检查 API Key。",
      modelNotFound: "找不到这个模型：请确认模型 ID 是否可用，或换一个模型。",
      timeout: "模型响应超时：请稍后重试，或换一个更快的模型。",
      providerError: "模型服务返回错误：请检查端点与网络后重试。",
      model: (model) => `模型 ${model}`,
    },
    detail: {
      back: "看板",
      requirement: "需求描述",
      requirementEmpty: "还没有需求描述：点「编辑」自己写，或用「一键生成」起草一版。",
      requirementAppendHint: "需求是任务执行时的说明；要补充或修正，写在下面的评论里。",
      requirementEditHint: "改写会替换掉任务当前的说明；只是补充内容的话，写在下面的评论里。",
      editRequirement: "编辑",
      saveRequirement: "保存需求",
      comments: "评论",
      noComments: "还没有评论。",
      commentPlaceholder: "补充需求或留言，跟踪这个任务…",
      sendComment: "发表评论",
      generateRequirement: "一键生成",
      generatingRequirement: "生成中…",
      generateRequirementConfirm: "用生成的需求替换当前需求描述？",
      generateRequirementHint: "根据标题和当前需求，生成一份带验收标准的敏捷需求",
      steerComment: "插入并打断",
      steerUnavailable: "仅在智能体执行中可以插入",
      interruptRun: "打断执行",
      authorAgent: "智能体",
      authorUser: "我",
      statusStarted: "已接手任务，开始执行",
      statusDone: "执行完成",
      statusFailed: "执行失败",
      statusInterrupted: "执行已中断",
      statusSteered: "留言已插入到当前执行",
      commentCount: (count) => `${count} 条评论`,
      loading: "正在加载任务…",
      notFound: "这个任务已经不在看板上了。",
    },
  },
  settings: {
    title: "设置",
    restoreDefaults: "恢复默认",
    backToApp: "返回应用",
    nav: {
      general: {
        label: "通用",
        description: "默认提供方、线程模式以及侧边栏的组织方式。",
      },
      appearance: {
        label: "外观",
        description: "主题、字体与时间格式。",
      },
      notifications: {
        label: "通知",
        description: "应用内提示与桌面通知。",
      },
      behavior: {
        label: "行为",
        description: "流式输出、差异处理与危险操作的二次确认。",
      },
      skills: {
        label: "技能",
        description: "当前工作区里智能体可用的技能。",
      },
      worktrees: {
        label: "工作树",
        description: "查看并清理由 Peak Code 创建的工作树。",
      },
      archived: {
        label: "已归档",
        description: "查看和恢复已归档的线程。",
      },
      piPackages: {
        label: "Pi 包",
        description: "从 npm、git 或本地路径安装 pi 包。",
      },
      modelProviders: {
        label: "模型提供商",
        description: "添加并编辑写入 models.json 的模型提供商与模型。",
      },
      advanced: {
        label: "高级",
        description: "快捷键、恢复与版本信息。",
      },
      channels: {
        label: "频道",
        description: "在微信、飞书/Lark、QQ 或 webhook 里直接给 Agent 派活。",
      },
      usage: {
        label: "使用统计",
        description: "归口统计本机各编码工具消耗的 Token。",
      },
    },
    groups: {
      basics: "基础设置",
      agent: "Agent 能力",
      data: "数据与统计",
    },
    general: {
      heading: "通用",
      description: "默认提供方、线程模式以及侧边栏的组织方式。",
      coreDefaults: "核心默认",
      sidebarOrganization: "侧边栏组织",
      language: {
        title: "语言",
        description: "选择 Peak Code 界面所使用的语言。",
        english: "English",
        chinese: "中文",
      },
      defaultProvider: {
        title: "默认提供方",
        description: "为新聊天选择使用的提供方。",
        resetLabel: "默认提供方",
      },
      defaultModel: {
        title: "默认模型",
        description: "新对话默认使用的模型。扫码配对的手机没有本地选择记录，会直接使用这里的设置。",
        resetLabel: "默认模型",
        automatic: "自动（首个可用模型）",
        automaticDescription: "未设置默认模型：每个新对话使用该提供方的第一个模型。",
      },
      newThreads: {
        title: "新线程",
        description: "选择新创建的草稿线程的默认工作区模式。",
        resetLabel: "新线程",
        local: "本地",
        worktree: "新建工作树",
      },
      sidebarPosition: {
        title: "位置",
        description: "选择侧边栏在屏幕的哪一侧显示。",
        left: "左侧",
        right: "右侧",
        resetLabel: "侧边栏位置",
      },
      projectOrder: {
        title: "项目排序",
        description: "控制主侧边栏中项目的排列方式。",
        recentlyActive: "最近活跃",
        recentlyAdded: "最近添加",
        manual: "手动排序",
        resetLabel: "项目排序",
      },
      threadOrder: {
        title: "线程排序",
        description: "控制主侧边栏中每个项目下线程的排列方式。",
        recentlyActive: "最近活跃",
        newestFirst: "最新优先",
        resetLabel: "线程排序",
      },
    },
    appearance: {
      heading: "外观",
      description: "主题、字体与时间格式。",
      themeAndTypographySection: "主题与排版",
      timeAndReadingSection: "时间与阅读",
      theme: {
        title: "主题",
        description: "选择 Peak Code 在整个应用中的外观。",
        system: "跟随系统",
        light: "浅色",
        dark: "深色",
        systemDescription: "跟随操作系统的外观设置。",
        lightDescription: "始终使用浅色主题。",
        darkDescription: "始终使用深色主题。",
      },
      lightThemeCard: {
        title: "浅色主题",
        contextActive: "当前正在使用的主题。",
        contextInactive: "应用已锁定为 {mode}，此主题暂不生效。",
        contextSystemActive: "系统当前正在使用该浅色主题。",
        contextSystemInactive: "当系统切换到浅色时使用。",
      },
      darkThemeCard: {
        title: "深色主题",
        contextActive: "当前正在使用的主题。",
        contextInactive: "应用已锁定为 {mode}，此主题暂不生效。",
        contextSystemActive: "系统当前正在使用该深色主题。",
        contextSystemInactive: "当系统切换到深色时使用。",
      },
      themePackReset: "重置",
      themePackCopy: "复制",
      themePackImport: "导入",
      themePackShareStringAria: "主题分享串",
      themePackCodeThemeAria: (label) => `${label} 代码主题`,
      themePackTranslucentAria: (label) => `${label} 半透明侧边栏`,
      themePackResetAria: (label) => `重置 ${label}`,
      themePackHexAria: (label) => `${label} 十六进制色值`,
      accent: "主色",
      background: "背景",
      foreground: "前景",
      uiFontLabel: "界面字体",
      codeFontLabel: "代码字体",
      translucentSidebar: "半透明侧边栏",
      contrast: "对比度",
      timestamp: {
        title: "时间格式",
        description: "默认跟随浏览器或系统的时钟偏好。",
        systemDefault: "系统默认",
        twelveHour: "12 小时制",
        twentyFourHour: "24 小时制",
        ariaLabel: "时间戳格式",
      },
      typography: {
        title: "排版",
        description: "界面字体、代码字体与聊天界面的基础字号。",
        uiFont: "界面字体",
        codeFont: "代码字体",
        baseFontSize: "基础字号",
        fontSmoothing: "字体平滑",
        uiFontDescription: "为界面设置自定义字体，留空则使用当前主题的界面字体。",
        codeFontDescription:
          "为聊天中的代码块与行内代码设置自定义字体，留空则使用当前主题的代码字体。",
        baseFontSizeDescription: "调整应用文本的基础像素值，聊天与界面排版会按此比例缩放。",
        fontSmoothingDescription: "启用 macOS 风格的反锯齿，使文字更轻盈清晰。",
        uiFontAria: "自定义界面字体族",
        codeFontAria: "自定义聊天代码字体族",
        baseFontSizeAria: "基础字号（像素）",
        fontSmoothingAria: "启用字体平滑",
        unitPx: "px",
      },
    },
    notifications: {
      heading: "通知",
      description: "应用内提示与桌面通知。",
      activityAlertsSection: "活动提醒",
      unavailableTitle: "桌面通知不可用",
      supportBrowserBlocked: "浏览器通知被禁用，请在站点设置中开启。",
      supportBrowserPrompt: "浏览器将提示授予通知权限。",
      supportBrowserGranted: "浏览器通知已开启。",
      supportDesktopUnsupported: "当前设备不支持桌面通知。",
      supportDesktopGranted: "桌面通知已开启。",
      supportDesktopDenied: "系统设置中桌面通知被禁用。",
      testTitle: "活动通知",
      testBody: "用于聊天和终端代理的通知测试。",
      testSuccessTitle: "测试通知已发送",
      testUnavailableTitle: "通知不可用",
      testSuccessDescriptionDesktop: "操作系统应显示该通知。",
      testUnavailableDescriptionDesktop: "当前设备不支持桌面通知。",
      testSuccessDescriptionBrowser: "浏览器应显示该通知。",
      testButton: "测试",
      activityToasts: {
        title: "活动提示",
        description: "当聊天或托管的终端代理结束或需要输入时，显示应用内提示。",
        ariaLabel: "活动提示通知",
      },
      desktopNotifications: {
        title: "桌面通知",
        description: "当应用处于后台时，聊天或托管的终端代理结束或需要输入时显示系统通知。",
        ariaLabel: "桌面活动通知",
      },
    },
    behavior: {
      heading: "行为",
      description: "流式输出、差异处理与危险操作的二次确认。",
      runtimeSection: "运行时行为",
      safetySection: "安全确认",
      assistantOutput: "助手输出",
      assistantOutputDescription: "响应进行中时，按 token 实时显示助手输出。",
      assistantOutputAria: "流式输出助手消息",
      diffLineWrapping: "差异换行",
      diffLineWrappingDescription:
        "设置差异面板打开时的默认换行状态。面板内的换行开关仅影响当前差异会话。",
      diffLineWrappingAria: "默认对差异行进行换行",
      deleteConfirmation: "删除确认",
      deleteConfirmationDescription: "在删除线程及其聊天历史之前要求确认。",
      deleteConfirmationAria: "确认删除线程",
      archiveConfirmation: "归档确认",
      archiveConfirmationDescription: "在归档线程之前要求确认。",
      archiveConfirmationAria: "确认归档线程",
      terminalCloseConfirmation: "关闭终端确认",
      terminalCloseConfirmationDescription: "在关闭终端标签页并清除其历史记录之前要求确认。",
      terminalCloseConfirmationAria: "确认关闭终端标签页",
    },
    worktrees: {
      heading: "工作树",
      description: "查看并清理由 Peak Code 创建的工作树。",
      managedSection: "托管的工作树",
      loading: "正在加载托管的工作树…",
      loadFailedFallback: "无法加载工作树。",
      emptyState: "尚未发现由应用托管的工作树。",
      worktreeLabel: "工作树",
      conversationsLabel: "会话",
      noConversations: "此工作树未关联任何会话。",
      deleteButton: "删除",
      deleteWarning: "存在关联的会话，删除时将要求二次确认。",
      verifyTitle: "无法验证关联的会话",
      verifyDescription: "请在应用重新连接服务器后再试。",
      deleteConfirmWithLinks: (name, count) =>
        `永久移除工作树「${name}」及 ${count} 个关联的已归档会话？`,
      deleteConfirm: (name) => `永久移除工作树「${name}」？`,
      deleteAnyway: "移除工作树",
      deleteLinkedActive: (active) => `${active} 个进行中`,
      deleteLinkedArchived: (archived) => `${archived} 个已归档`,
      deleteArchivedWillDeleteFirst: "已归档的会话会先被删除。",
      deleteLinkedWarning: "删除后可能无法在同一个工作区中重新打开这些聊天。",
      deleteRemovesFromDisk: "这将从磁盘上移除该 Git 工作树。",
      deletedTitle: "工作树已删除",
      deletedDescriptionWithArchived: (name, count) =>
        `「${name}」已移除，${count} 个已归档会话已删除。`,
      deletedDescription: (name) => `「${name}」已移除。`,
      deleteErrorTitle: "无法删除工作树",
      deleteErrorFallback: "无法删除该工作树。",
    },
    archived: {
      heading: "已归档",
      description: "查看和恢复已归档的线程。",
      emptySection: "已归档线程",
      emptyTitle: "暂无已归档线程",
      emptyDescription: "已归档的线程会出现在这里，可以恢复到侧边栏。",
      unknownProject: "未知项目",
      archivedAt: (when) => `${when} 归档`,
      restoreButton: "恢复",
      deleteButton: "删除",
      restoreTitle: "线程已恢复",
      restoreDescription: "该线程已移回侧边栏。",
      restoreErrorTitle: "无法恢复线程",
      restoreErrorFallback: "无法恢复该线程。",
      deleteConfirm: (title) => `永久删除「${title}」？\n\n这将移除该线程及其对话历史。`,
      deleteTitle: "线程已删除",
      deleteDescription: "该已归档线程已被永久移除。",
      deleteErrorTitle: "无法删除线程",
      deleteErrorFallback: "无法删除该线程。",
      contextMenuRestore: "恢复",
      contextMenuDelete: "删除",
    },
    models: {
      heading: "模型",
      description: "写入 Git 的默认模型与自定义模型。",
      generationSection: "生成默认值",
      customSection: "自定义模型",
      gitWritingModel: "Git 写入模型",
      gitWritingModelDescription: "用于生成提交信息、PR 标题与分支名。",
      gitWritingModelAria: "Git 文本生成模型",
      customModelEmpty: "请输入模型标识。",
      customModelBuiltIn: "该模型已是内置。",
      customModelTooLong: (max) => `模型标识不得超过 ${max} 个字符。`,
      customModelDuplicate: "该自定义模型已存在。",
      customModelResetLabel: "自定义模型",
      customAddPlaceholder: "添加自定义模型标识",
      customAddButton: "添加",
      customAddAria: "添加自定义模型",
      customProviderAria: "自定义模型提供方",
      customRemoveAria: (slug) => `移除 ${slug}`,
      customShowLess: "收起",
      customShowMore: (count) => `展开更多 (${count})`,
      savedModelSlugs: "已保存的模型标识",
      savedModelSlugsDescription: "为支持的提供方添加自定义模型标识。",
    },
    providers: {
      heading: "提供方",
      description: "选择可见的提供方、查看 CLI 安装状态并更新提供方工具。",
      updatesSection: "更新",
      pickerSection: "提供方选择器",
      toolsSection: "提供方工具",
      installTitle: (providerName) => `${providerName} 安装`,
      visibility: {
        title: "可见的提供方",
        description:
          "拖动调整选择器顺序，并隐藏不使用的提供方。当前线程正在使用的提供方始终保持可见。",
        statusAllVisible: "所有提供方均可见",
        statusCustomOrder: "自定义顺序",
        statusHidden: (count) => `已隐藏 ${count} 个提供方`,
        statusHiddenOne: "已隐藏 1 个提供方",
        showAria: (name) => `在选择器中显示 ${name}`,
        reorderAria: (name) => `调整 ${name} 顺序`,
        resetLabel: "提供方选择器",
      },
      updates: {
        title: "提供方更新",
        description: "更新 Peak Code 可以安全更新的已安装提供方工具。",
        statusNoUpdates: "未检测到提供方更新",
        statusAvailableOne: "有 1 项可用更新",
        statusAvailableMany: (count) => `有 ${count} 项可用更新`,
        statusAvailablePlural: (count) => `有 ${count} 项可用更新`,
        manualUpdate: "手动更新",
        updateButton: "更新",
        updatingButton: "正在更新",
        commandLabel: "命令：",
        runCommandTitle: (command) => `运行 ${command}`,
        versionAdvisoryNoCommand:
          "检测到新版本，但 Peak Code 未能为该安装识别出安全的一键更新命令。",
      },
      tools: {
        title: "已安装的 CLI",
        description: "查看提供方版本并更新工具，仅在需要覆写二进制路径时展开对应行。",
        statusNoUpdates: "未检测到提供方更新",
        statusAvailableOne: "有 1 项可用更新",
        statusAvailableMany: (count) => `有 ${count} 项可用更新`,
        statusAvailablePlural: (count) => `有 ${count} 项可用更新`,
        customBadge: "自定义",
        resetLabel: "提供方工具",
        binaryPathLabel: (providerName) => `${providerName} 可执行文件路径`,
        homePathLabel: "CODEX_HOME 路径",
        homePathDescription: "可选的自定义 Codex 主目录与配置目录。",
        agentDirLabel: "Pi 代理目录",
        agentDirDescription: "可选的自定义 Pi 代理目录，用于鉴权、模型、技能与命令。",
        apiEndpointLabel: "Cursor API 端点",
        apiEndpointDescription: "可选的 Cursor API 端点覆写，会传给 `cursor-agent -e`。",
        serverUrlLabel: (providerName) => `${providerName} 服务器地址`,
        serverUrlDescription: (providerName) =>
          `可选的现有 ${providerName} 服务器地址，留空将启动本地服务器。`,
        serverPasswordLabel: (providerName) => `${providerName} 服务器密码`,
        serverPasswordDescription: (providerName) => `可选的外部管理 ${providerName} 服务器密码。`,
        binaryPathDescription: (command) => `留空将使用 PATH 中的 \`${command}\`。`,
        binaryPathPlaceholder: (providerName) => `${providerName} 可执行文件路径`,
        homePathPlaceholder: "CODEX_HOME",
        agentDirPlaceholder: "Pi 代理目录",
        apiEndpointPlaceholder: "https://api2.cursor.sh",
        serverUrlPlaceholder: "http://127.0.0.1:4096",
        serverPasswordPlaceholder: (providerName) => `${providerName} 服务器密码`,
      },
      docs: {
        install: "安装",
        update: "更新",
        config: "配置",
        headless: "无头模式",
        label: "CLI 文档",
      },
      update: {
        queued: "更新已排队",
        updating: "更新中",
        updated: "已更新",
        failed: "更新失败",
        stillOutdated: "仍为旧版",
        versionDelta: (current, latest) => `${current} → ${latest}`,
        latest: (version) => `最新 ${version}`,
        current: (version) => `当前 ${version}`,
        errorFallback: "提供方更新未完成。",
      },
      cliDocs: "CLI 文档",
    },
    modelProviders: {
      heading: "模型提供商",
      description:
        "配置 AI 模型提供商（OpenAI、DeepSeek、Ollama 等）及其模型。保存会写入 models.json 并刷新模型选择器。",
      filePathLabel: "配置文件",
      builtinHint:
        "Pi 已内置常见提供商（OpenAI、Anthropic、Google、MiniMax）。仅当需要自定义端点或额外模型时，才在这里添加提供商。",
      emptyTitle: "尚未配置提供商",
      emptyDescription: "从常用模板添加一个提供商，或自定义填写。",
      builtinGroupLabel: "内置",
      customGroupLabel: "自定义供应商",
      loadFailedTitle: "无法加载模型提供商",
      loadFailedFallback: "这通常意味着 models.json 格式损坏。请先手动修复文件，再重新加载。",
      addButton: "添加提供商",
      addDialogTitle: "添加模型提供商",
      templateLabel: "模板",
      templateAria: "提供商模板",
      templateCustom: "自定义提供商",
      providerExistsHint: (name) => `${name} 已存在，将更新而不是重复添加。`,
      providerKeyLabel: "提供商 Key",
      providerNameLabel: "显示名称",
      providerApiLabel: "API 类型",
      providerBaseUrlLabel: "Base URL",
      providerApiKeyLabel: "API Key",
      providerApiKeyHint:
        "字面量密钥会作为凭证保存到 Pi 的凭证库（auth.json），不会写入配置文件。若想在配置文件里只保留引用，请使用 $ENV_VAR、${ENV_VAR} 或 !shell 命令（如 !op read …）。",
      providerApiKeyPlaceholder: (env) => `密钥字面量，或形如 $${env} 的引用`,
      providerStoredKeyHint: "密钥已保存到 Pi 的凭证库，之后不再回显；输入新值即可替换。",
      providerClearKeyButton: "清除已保存的密钥",
      providerModelsLabel: "模型",
      modelAddButton: "添加模型",
      modelFetchButton: "获取模型列表",
      remoteModelsTitle: (provider) => `${provider} · 可用模型`,
      remoteModelsLoading: "正在获取服务商的模型列表…",
      remoteModelsFailed: "无法读取服务商的模型列表。",
      remoteModelsSummary: (total, missing) => `共返回 ${total} 个模型 · 还有 ${missing} 个未添加`,
      remoteModelsSearchPlaceholder: "搜索模型 ID",
      remoteModelsEmpty: "服务商没有返回任何模型。",
      remoteModelsNoMatch: "没有匹配当前筛选的模型。",
      remoteModelsAdd: "添加",
      remoteModelsAdded: "已添加",
      remoteModelsAddAria: (id) => `添加模型 ${id}`,
      remoteModelsAddAll: "全部添加",
      remoteModelsAddGroup: "添加本组",
      remoteModelsGroupOther: "未分组",
      remoteModelsAddedCount: (count) => `已添加 ${count} 个`,
      modelCategoryAll: "全部",
      modelCategories: {
        chat: "对话",
        embedding: "嵌入",
        rerank: "重排",
        tts: "语音合成",
        asr: "语音识别",
        image: "图像",
        video: "视频",
        music: "音乐",
        other: "其他",
      },
      modelIdLabel: "模型 ID",
      modelIdPlaceholder: "模型 ID",
      modelContextLabel: "上下文窗口",
      modelContextBadge: (value) => `上下文 ${value}`,
      modelMaxTokensLabel: "最大输出 Token",
      modelMaxTokensBadge: (value) => `输出 ${value}`,
      modelInputTypesLabel: "输入类型",
      modelOutputTypesLabel: "输出类型",
      inputTypes: {
        text: "文本",
        image: "图片",
        video: "视频",
        pdf: "PDF",
      },
      modelAddTitle: "添加模型",
      modelEditTitle: "编辑模型",
      modelSaveButton: "保存",
      modelEditAria: (id) => `编辑 ${id}`,
      modelRemoveAria: (id) => `移除模型 ${id}`,
      providerRemoveAria: (name) => `移除提供商 ${name}`,
      providerRemoveConfirm: (name) => `确定移除提供商 ${name}？保存前无法恢复。`,
      saveButton: "保存修改",
      savingButton: "保存中…",
      savedTitle: "模型提供商已保存",
      testButton: "测试连接",
      testHint: "向第一个已配置模型（或第一个内置模型）发送简短请求，可能产生少量 API 用量。",
      testAutoSaveHint: "会先保存当前修改，再测试连接。可能产生少量 API 用量。",
      enableButton: "启用",
      enableSavingButton: "启用中…",
      enabledStatus: "已启用",
      disabledStatus: "未启用",
      enablePaneTitle: (name) => `启用 ${name}`,
      enablePaneHint:
        "为此提供商粘贴一个 API Key 后点击「启用」。它会写入 models.json 并进行一次连接测试。未启用的提供商在启用前不会写入配置。",
      testResults: {
        success: "连接成功",
        "invalid-config": "Pi 无法加载模型配置，请检查 models.json。",
        "model-not-found": "未找到匹配的模型，请先添加模型。",
        "auth-missing": "无法解析凭证，请检查 API Key 或环境变量。",
        timeout: "连接超时（20 秒）。",
        "request-failed": "请求失败，请检查端点、凭证、模型访问权限和网络。",
      },
      unsavedHint: "有未保存的修改。",
      cancelButton: "取消",
    },
    channels: {
      heading: "频道",
      description:
        "把聊天工具接到这个工作区：在聊天里发的消息会开出一个线程，Agent 的回复也会发回聊天。",
      names: {
        wechat: "微信 · 个人号",
        feishu: "飞书 / Lark",
        qq: "QQ 机器人",
        wecom: "企业微信应用",
        wechatMp: "微信公众号",
        webhook: "Webhook",
      },
      status: {
        connected: "已连接",
        connecting: "连接中…",
        off: "未连接",
        failed: "连接失败",
        notConfigured: "未配置",
      },
      actions: {
        save: "保存",
        saving: "保存中…",
        saved: "已保存",
        edit: "编辑",
        test: "测试连接",
        testing: "测试中…",
        disconnect: "断开",
        forget: "忘记会话",
        refresh: "刷新",
      },
      wechat: {
        title: "微信 · 个人号",
        description:
          "用手机微信扫码接入，之后给这个号发消息即可：消息由本机长轮询获取，不需要公网地址。",
        scan: "扫码接入微信",
        rescan: "重新扫码更换账号",
        scanHint: "用微信扫一扫，登录后给这个号发一条消息试试。",
        waiting: "等待手机扫码…",
        scanned: "已扫码，请在手机上确认",
        expired: "二维码已过期，请重新获取",
        confirmed: "已接入",
        disconnectConfirm: "断开微信接入？断开后微信里将不再收到回复。",
      },
      feishu: {
        title: "飞书 / Lark",
        description:
          "在开放平台创建自建应用，加上机器人能力与 im:message 权限，事件订阅选「长连接」。不需要公网地址。",
        domain: "平台",
        domainFeishu: "飞书（中国）",
        domainLark: "Lark（国际）",
        appId: "App ID",
        appSecret: "App Secret",
        secretPlaceholder: "留空表示保持已保存的密钥",
      },
      qq: {
        title: "QQ 机器人",
        description:
          "开放平台创建的机器人应用：开启消息列表后填入 AppID / AppSecret，长连接模式，不需要公网地址。",
        appId: "App ID",
        appSecret: "App Secret",
      },
      wecom: {
        title: "企业微信 · 自建应用",
        description: "回调模式：由腾讯回调本机，所以需要公网 HTTPS 地址。",
        callbackHint: "回调地址",
        corpId: "Corp ID",
        agentId: "Agent ID",
        secret: "Secret",
        callbackToken: "回调 Token",
        encodingAesKey: "EncodingAESKey",
      },
      wechatMp: {
        title: "微信公众号",
        description: "回调模式：结果通过客服消息主动推送，需要已认证的账号和公网 HTTPS 地址。",
        callbackHint: "回调地址",
        appId: "App ID",
        appSecret: "App Secret",
        callbackToken: "Token",
        encodingAesKey: "EncodingAESKey",
      },
      webhooks: {
        title: "Webhook",
        description: "群机器人负责播报（只出不进）；入站桥接让任何能发 HTTP 的工具跑任务。",
        wecomUrl: "企业微信群机器人地址",
        dingtalkUrl: "钉钉机器人地址",
        dingtalkSecret: "钉钉加签密钥",
        inboundSecret: "入站桥接密钥",
        taskHint: "POST /api/im/task，参数 { message, session, secret }",
      },
      behavior: {
        title: "IM 任务的执行方式",
        description: "IM 线程开在哪个工作区，以及给 Agent 多大权限。",
        project: "工作区",
        projectAuto: "最近使用的项目",
        idleHours: "空闲重置（小时）",
        idleHoursHint:
          "超过这个时间没有新消息，会话会重新开始（节省上下文）。填 0 表示一直续用同一个上下文。",
        runtimeMode: "权限档位",
        modeApproval: "需要审批",
        modeFull: "全自动",
        runtimeModeHint:
          "IM 任务执行时人不在电脑前，需要审批的命令会一直等下去。全自动是一个明确的选择——文件保护依然生效。",
      },
      conversations: {
        title: "已接入的会话",
        description: "每个会话有自己的线程；忘记后会从下一条消息重新开始。",
        empty: "还没有任何会话跟这个工作区对话过。",
        forget: "忘记",
      },
      log: {
        title: "最近消息",
        empty: "还没有消息经过桥接层。",
        incoming: "收到",
        outgoing: "发出",
        error: "错误",
      },
      mobile: {
        title: "移动端远程控制",
        description: "扫码用手机遥控这台电脑，或接入聊天 Bot 以便更长期的移动端访问。",
        phoneTitle: "手机扫码连接",
        phoneDescription:
          "扫码后手机上打开的是这台电脑的远程控制页：可以看到这里正在跑的工作区和任务，也能接着对话——执行仍然在这台电脑上。",
        waiting: "等待手机连接",
        ready: "已就绪",
        stop: "停止",
        refresh: "刷新二维码",
        copyLink: "复制链接",
        copied: "链接已复制",
        linkHint: "无法扫码？可以在手机上打开链接。",
        botTitle: "使用 Bot Channel",
        botDescription: "连接聊天 Bot，适合更长时间的移动端访问。",
        openSettings: "去频道配置",
        manageTitle: "机器人管理",
        manageDescription: "当前已经接到线程上的会话。",
        manageEmpty: "还没有会话接入。",
        loadFailed: "无法连接 IM 桥接层。",
        sidebarTooltip: "移动端与 IM 频道",
        opensThread: (title) => `扫码后直接打开「${title}」`,
        opensProject: (project) => `扫码后在 ${project} 里新建一个对话`,
        defaultModelSet: (model) => `手机上发消息使用 ${model}`,
        defaultModelUnset:
          "还没有设置默认模型，手机会使用第一个可用模型——可以在「设置 → 通用」里指定。",
      },
      remote: {
        title: "Cloudflare 外网访问",
        description:
          "把这个工作区发布到一个临时的 Cloudflare 地址，手机在任何网络下都能打开——不用端口转发，也不需要公网 IP。",
        start: "开启 Cloudflare 隧道",
        starting: "正在开启隧道…",
        stop: "关闭隧道",
        connected: "隧道已连接",
        connecting: "正在连接…",
        off: "隧道未开启",
        failed: "隧道启动失败",
        urlLabel: "公网地址",
        copy: "复制地址",
        copied: "地址已复制",
        publicWarning:
          "这个地址是公开的：拿到地址的人仍需配对（一次性链接 + 会过期的会话），但隧道开着的时候就当它是暴露状态。",
        needsToken:
          "当前服务端没有访问令牌，因此拒绝对外开放。请用 --auth-token <token> 重启 Peak Code（桌面版自带令牌）后再试。",
        autoStart: "启动时自动开启隧道",
        autoStartHint: "重启后二维码依然可用。",
        binaryPath: "cloudflared 路径",
        binaryPathHint: "默认为 PATH 里的 cloudflared（macOS: brew install cloudflared）。",
        lastUrl: "上次的地址",
        openHint: "扫下方的二维码，在手机上打开这个工作区。",
      },
    },
    usage: {
      badge: "本机用量",
      scope: (days) => `统计范围：本机各编码工具的本地会话记录，最近 ${days} 天。`,
      refresh: "刷新",
      loading: "正在读取本地用量日志…",
      errorTitle: "加载使用统计失败",
      emptyTitle: "还没有用量记录",
      emptyDescription: "在本机任意一个编码工具里跑一次会话，这里就会显示它的 Token 消耗。",
      generatedAt: (time) => `更新于 ${time}`,
      filter: {
        label: "工具",
        all: "全部工具",
      },
      stats: {
        cumulativeTokens: "累计 Token 数",
        peakTokens: "峰值 Token 数",
        longestChat: "最长聊天时长",
        currentStreak: "当前连续天数",
        longestStreak: "最长连续天数",
      },
      mix: {
        title: "Token 构成",
        input: "输入",
        output: "输出",
        cacheRead: "缓存读",
        cacheWrite: "缓存写",
      },
      tools: {
        title: "工具用量",
        description: "本机各工具的 Token 占比。",
        inactive: "未检测到记录",
        sessions: (count) => `${count} 个会话`,
        models: (count) => `${count} 个模型`,
        lastUsed: (time) => `最后使用 ${time}`,
      },
      activity: {
        title: "Token 活动",
        daily: "每日",
        weekly: "每周",
        cumulative: "累计",
        tokensUnit: "tokens",
        responses: (count) => `${count} 轮消息`,
        weekTotal: (tokens) => `本周 ${tokens} tokens`,
        cumulativeTotal: (tokens) => `累计 ${tokens} tokens`,
      },
      range: {
        label: "时间范围",
        last7: "近 7 日",
        last30: "近 30 日",
      },
      trend: {
        title: "每日 Token 趋势图",
      },
      models: {
        title: "模型用量",
        other: "其他",
      },
      sessions: {
        title: "最近会话",
        project: "项目",
        duration: "时长",
        requests: "请求数",
        requestCount: (count) => `${count} 次请求`,
        detail: "请求明细",
        detailTitle: "会话请求明细",
        detailEmpty: "这个会话没有可展示的请求记录。",
        dropped: (count) => `仅显示最近的请求，另有 ${count} 条较早的请求已释放。`,
        unavailable: "该会话的请求明细已超出保留范围。",
        time: "时间",
        model: "模型",
        input: "输入",
        output: "输出",
        cache: "缓存读/写",
        total: "合计",
        close: "关闭",
      },
    },
    piPackages: {
      heading: "Pi 包",
      description:
        "pi 包可同时携带扩展、技能、提示词模板与主题。安装会把来源写入 settings.json，新线程会自动加载。",
      settingsPathLabel: "记录于",
      sourceLabel: "包来源",
      sourcePlaceholder: "npm:@scope/pkg 或 git:host/user/repo",
      sourceHint:
        "npm 来源通过全局 npm 前缀安装；git 来源克隆到 pi agent 目录；本地路径则直接引用，不复制。",
      installButton: "安装",
      installingButton: "安装中…",
      loadingLabel: "正在读取已安装的包…",
      loadFailedTitle: "无法读取 pi 包",
      loadFailedFallback: "请确认 pi agent 目录可读。",
      emptyTitle: "尚未安装任何包",
      emptyDescription: "安装一个包，即可为所有线程加入扩展、技能或提示词模板。",
      projectScopeLabel: "项目级",
      filteredLabel: "资源已停用",
      notInstalledLabel: "尚未落盘——下次会话启动时安装。",
      reloadHint: "扩展在会话启动时加载。已打开的线程可执行 /reload 以载入新安装的包。",
      resources: {
        skills: "技能",
        prompts: "提示词",
        extensions: "扩展",
        themes: "主题",
      },
      removeConfirm: (source) => `卸载 ${source} 并从设置中移除？`,
      removeAria: (source) => `卸载 ${source}`,
    },
    advanced: {
      heading: "高级",
      description: "快捷键、恢复与版本信息。",
      developerSection: "开发者工具",
      aboutSection: "关于",
      keybindings: {
        title: "快捷键",
        description: "打开持久化的 `keybindings.json` 文件以直接编辑高级快捷键。",
        pathPlaceholder: "正在解析快捷键路径…",
        openEditorHint: "将使用你偏好的编辑器打开。",
        openButton: "打开文件",
        openingButton: "正在打开…",
        noEditor: "未找到可用编辑器。",
        openError: "无法打开快捷键文件。",
        noEditorToast: "未找到可用编辑器。",
        openErrorFallback: "无法打开快捷键文件。",
        openErrorUnknown: "无法打开快捷键文件。",
      },
      recovery: {
        title: "恢复工具",
        description: "当本地状态不同步时重建本地项目索引，且不会清空现有聊天。",
        offerReason: "因存在项目但当前无聊天记录而显示。",
        hiddenReason: "仅在恢复操作适用时自动显示。",
        whatThisDoesLabel: "这会做什么",
        whatThisDoesBody: "重建本地项目索引并刷新项目快照，现有聊天保持不变。",
        repairButton: "修复状态",
        repairingButton: "正在修复…",
        confirmTitle: "修复本地状态？",
        confirmDescription: "这会重建本地项目索引并刷新项目快照。",
        confirmSpacer: "不会清空现有聊天，但可能需要一些时间。",
        successTitle: "本地状态已修复",
        successDescription: "项目索引已重建，现有聊天未受影响。",
        errorTitle: "修复失败",
        errorFallback: "无法修复本地状态。",
      },
      version: {
        title: "版本",
        description: "当前应用版本。",
      },
    },
    changedSettingLabel: {
      theme: "主题",
      darkThemePack: "深色主题包",
      lightThemePack: "浅色主题包",
      defaultProvider: "默认提供方",
      defaultModel: "默认模型",
      newThreadMode: "新线程模式",
      sidebarPosition: "侧边栏位置",
      projectSortOrder: "项目排序",
      threadSortOrder: "线程排序",
      uiFont: "界面字体",
      codeFont: "代码字体",
      baseFontSize: "基础字号",
      fontSmoothing: "字体平滑",
      timeFormat: "时间格式",
      activityToasts: "活动提示",
      desktopNotifications: "桌面通知",
      assistantOutput: "助手输出",
      diffLineWrapping: "差异换行",
      deleteConfirmation: "删除确认",
      archiveConfirmation: "归档确认",
      terminalCloseConfirmation: "关闭终端确认",
      gitWritingModel: "Git 写入模型",
      customModels: "自定义模型",
      providerInstalls: "提供方安装",
      providerVisibility: "提供方可见性",
      providerOrder: "提供方顺序",
      language: "语言",
    },
    resetAria: (label) => `将「${label}」重置为默认`,
    resetTooltip: "重置为默认",
    restoreDefaultsConfirm: (labels) => `恢复默认设置？\n将重置：${labels}。`,
    themePack: {
      importTitle: "导入主题包",
      importDescription: "粘贴一个已分享的主题包字符串以立即应用。",
      apply: "应用",
      reset: "重置",
    },
  },
  dialog: {
    confirm: {
      deleteThread: (title) => `「${title}」\n\n这将永久删除该线程及其历史记录。`,
      deleteThreadPermanent: "删除线程",
      archiveThread: "归档线程",
      removeProject: (name) => `从侧边栏移除「${name}」？`,
      removeProjectAndThreads: (name, count) => `从侧边栏移除「${name}」并删除 ${count} 个线程？`,
      cancel: "取消",
      continue: "删除",
      discardDraft: "放弃新线程草稿？",
    },
    rename: {
      title: "重命名聊天",
      description: "保持简短易记。",
      submit: "重命名",
      cancel: "取消",
    },
    pullRequest: {
      title: "关联 Pull Request",
      description: "粘贴 GitHub Pull Request 的 URL 或编号以关联到此线程。",
      placeholder: "https://github.com/owner/repo/pull/42 或 #42",
      open: "打开",
      cancel: "取消",
    },
    worktreeHandoff: {
      title: "交接至工作树",
      description: "将会话迁移到新工作树中，避免中断当前工作。",
      submit: "交接",
      cancel: "取消",
    },
  },
  whatsNew: {
    title: "新增内容",
    popoutTitle: "Peak Code 更新内容",
    open: "打开",
    dismiss: "忽略",
    gotIt: "知道了",
    releaseNotes: "更新说明",
    readMore: "阅读更多",
    showLess: "收起",
    highlights: "亮点",
    allReleases: "所有版本",
    versionLabel: (version) => `v${version}`,
  },
  taskCompletion: {
    markAllRead: "全部标记为已读",
    viewChat: "查看聊天",
  },
  workspace: {
    fallbackTitle: "工作区",
    renameHint: "双击重命名",
    terminalTab: "终端",
    settingsAria: "工作区设置",
    loading: "正在加载工作区",
    emptyTitle: "没有打开的工作区",
    openInEditor: "在编辑器中打开",
  },
  terminal: {
    findPlaceholder: "查找",
    matchCase: "区分大小写",
    tabTerminal: "终端",
    tabChat: "聊天",
  },
  gitActions: {
    groupAria: "Git 操作",
    optionsAria: "Git 操作选项",
    prTitlePlaceholder: "留空以自动生成",
    linkUnavailable: "链接打开不可用。",
    noOpenPR: "未找到打开的 PR。",
    openPRErrorTitle: "无法打开 PR 链接",
    syncingTitle: "正在与远程同步…",
    syncSuccess: "远程已同步",
    alreadyUpToDate: "已是最新",
    syncFailed: "同步失败",
    createPRUnavailable: "无法创建 PR",
    noChanges: "没有可包含在 PR 中的变更。",
    running: "正在执行 Git 操作…",
    waiting: "等待 Git…",
    keeping: (name) => `保留 ${name}`,
    branchConfirmed: "分支名已确认。",
    creatingBranch: "正在创建分支…",
    switchedTo: (name) => `已切换到 ${name}`,
    createdCheckedOut: "分支已创建并签出。",
    createFailed: "创建分支失败",
    editorUnavailable: "编辑器打开不可用。",
    openFileFailed: "无法打开文件",
  },
  browser: {
    screenshotCopied: "浏览器截图已复制",
    urlPlaceholder: "搜索或输入 URL",
    actionsAria: "浏览器操作",
  },
  branchToolbar: {
    newWorktree: "新建工作树",
    handoffNewWorktree: "交接至新工作树",
    handoffLocal: "交接至本地",
    rateLimitsRemaining: "剩余速率限制",
    checkoutPR: "签出 Pull Request",
    searchPlaceholder: "搜索分支…",
    createTitle: "创建分支",
    discardStash: "放弃已保存的 stash？",
    loadingStash: "正在加载 stash…",
    fieldBranch: "分支",
    fieldWorktree: "工作树",
    fieldStash: "Stash",
    fieldName: "名称",
  },
  projectScripts: {
    groupAria: "项目脚本",
    actionAria: "脚本操作",
    editAria: (name) => `编辑 ${name}`,
    nameLabel: "名称",
    chooseIcon: "选择图标",
    testPlaceholder: "测试",
    keybindingLabel: "快捷键",
    pressShortcut: "按下快捷键",
    pressShortcutHint: "按下快捷键。使用退格键清除。",
    commandLabel: "命令",
    autoRunLabel: "创建工作树时自动运行",
    deleteConfirmDescription: "此操作无法撤销。",
    addScript: "添加脚本",
    delete: "删除",
    deleteConfirmTitle: (name) => `删除操作“${name}”？`,
    deleteAction: "删除操作",
  },
  themeEditor: {
    copiedTitle: "主题已复制",
    copiedDescription: (variant) => `已复制 ${variant} 主题分享串。`,
    copyFailedTitle: "复制失败",
    copyFailedDescription: "无法复制主题分享串。",
    codeAria: (label) => `${label} 代码主题`,
    systemDefault: "系统默认",
    translucentSidebar: "半透明侧边栏",
    translucentSidebarAria: (label) => `${label} 半透明侧边栏`,
    resetAria: (label) => `重置 ${label}`,
    resetTitle: "重置为默认",
    hexValueAria: (label) => `${label} 十六进制值`,
    importedTitle: "主题已导入",
    importedDescription: (variant) => `${variant} 主题包已更新。`,
    shareStringAria: "主题分享串",
    background: "背景",
    text: "文本",
    accent: "强调色",
    border: "边框",
    status: "状态",
    code: "代码",
    light: "浅色",
    dark: "深色",
    reset: "重置",
    shareString: "分享串",
    apply: "应用",
    import: "导入",
    foreground: "前景色",
    uiFont: "界面字体",
    codeFont: "代码字体",
    codeFontPlaceholder: '"JetBrains Mono"',
    contrast: "对比度",
    contextActiveSystem: (variant) => `系统当前正在使用此 ${variant} 主题。`,
    contextActiveLocked: "这是当前使用的主题。",
    contextInactiveSystem: (variant) => `当系统切换到 ${variant} 时使用。`,
    contextInactiveLocked: (mode) => `应用已锁定为 ${mode} 模式，此主题未启用。`,
    importDialogTitle: (variant) => `导入${variant === "dark" ? "深色" : "浅色"}主题`,
    importDialogDescription: (variant) =>
      `粘贴 codex-theme-v1: 分享串。嵌入的变体必须匹配 ${variant}，且所选代码主题必须存在于该变体。`,
    importDialogCancel: "取消",
    importDialogSubmit: "导入",
    importError: "无法导入该主题字符串。",
    importPlaceholder: 'codex-theme-v1:{"codeThemeId":"linear",...}',
    copy: "复制",
  },
  themePack: {
    importTitle: "导入主题包",
    importDescription: "粘贴一个已分享的主题包字符串以立即应用。",
    apply: "应用",
    reset: "重置",
  },
  restoreDefaults: {
    title: "恢复默认",
    description: (labels) => `恢复默认设置？\n将重置：${labels}。`,
    button: "恢复",
  },
  keybindings: {
    searchPlaceholder: "搜索快捷键…",
    title: "键盘快捷键",
  },
  rateLimits: {
    reachedTitle: "已达到速率限制。",
    approachingTitle: "接近速率限制",
    planLimitTitle: "已达套餐限制",
    noData: "暂无速率限制数据。",
  },
  providerUsage: {
    title: (providerName) => `${providerName} 用量`,
    fallbackTitle: "用量",
    window: "时间窗",
    resetsAt: "重置于",
    noData: "暂无用量数据。",
  },
  debug: {
    actionFailed: "操作失败",
    fallback: "发生错误。",
  },
  notification: {
    retention: {
      title: "正在清理旧聊天…",
      preparing: "正在准备后台清理。",
      progress: (purged, total) => `已移除 ${purged} / {total} 个聊天。`,
      progressSimple: (purged) => `已移除 ${purged} 个聊天。`,
      compactingTitle: "正在压缩聊天数据库…",
      compactingReclaim: "正在回收未使用的数据库空间。",
      compactingFinishing: "正在完成清理。",
      pausedTitle: "清理已暂停",
      pausedDescription: "旧聊天将稍后重试。",
      successTitle: "旧聊天已清理",
      successDescription: (purged) => `已从数据库移除 ${purged} 个聊天。`,
      successDescriptionEmpty: "无需清理旧聊天。",
    },
    providerUpdate: {
      title: (providerName) => `正在更新 ${providerName}。`,
      titleMany: (count) => `正在更新 ${count} 个提供方。`,
      description: (providerName) => `正在更新 ${providerName}。`,
      descriptionMany: (count) => `正在更新 ${count} 个提供方。`,
      errorFallback: "更新命令未成功完成。",
      stillOutdated: "更新后该提供方仍显示为旧版。",
      requestFailed: "更新请求失败。",
      failedTitleAll: "提供方更新失败",
      failedTitleSome: "部分提供方更新失败",
      successTitleOne: (providerName) => `${providerName} 已更新`,
      successTitleMany: (count) => `已更新 ${count} 个提供方`,
      successDescription: "新会话将使用已刷新的提供方工具。",
      availableTitleOne: (providerName) => `${providerName} 有可用更新`,
      availableTitleMany: (count) => `${count} 个提供方有可用更新`,
      availableDescriptionOne: (providerName) => `${providerName} 有更新版本可用。`,
      availableDescriptionMany: (providerName, count) =>
        `${providerName} 及其他 ${count} 个提供方有更新版本可用。`,
      actionReview: "查看更新",
      actionUpdateAll: "全部更新",
    },
    keybindings: {
      invalidTitle: "快捷键配置无效",
      openConfigAction: "打开 keybindings.json",
      noEditor: "未找到可用编辑器。",
      openFileErrorTitle: "无法打开快捷键文件",
      openFileErrorFallback: "打开文件时出现未知错误。",
    },
  },
};

export const MESSAGES: Record<Language, Messages> = { en, zh };
export const NATIVE_LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  zh: "中文",
};
