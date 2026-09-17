// FILE: imReactQuery.ts
// Purpose: React Query bindings for the IM bridge — status polling plus the mutations the
//          channels panel runs (WeChat login, connectivity tests, forgetting a chat).
// Layer: Web data access
// Exports: imQueryKeys, useImStatusQuery, useImConversationsQuery, channel mutation hooks

import type { ImChannelId } from "@peakcode/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { imApi } from "./imApi";

export const imQueryKeys = {
  status: () => ["im", "status"] as const,
  conversations: () => ["im", "conversations"] as const,
};

/**
 * Connection states change in the background (a long connection comes up, a QR code is
 * confirmed on a phone), so the panel polls while it is visible.
 */
export function useImStatusQuery() {
  return useQuery({
    queryKey: imQueryKeys.status(),
    queryFn: () => imApi.getStatus(),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useImConversationsQuery() {
  return useQuery({
    queryKey: imQueryKeys.conversations(),
    queryFn: () => imApi.listConversations(),
    refetchInterval: 15_000,
    retry: false,
  });
}

function useRefreshImStatus() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: imQueryKeys.status() });
    void queryClient.invalidateQueries({ queryKey: imQueryKeys.conversations() });
  };
}

export function useTestChannelMutation() {
  const refresh = useRefreshImStatus();
  return useMutation({
    mutationFn: (channel: ImChannelId) => imApi.testChannel(channel),
    onSettled: refresh,
  });
}

export function useWechatQrCodeMutation() {
  return useMutation({ mutationFn: () => imApi.createWechatQrCode() });
}

export function useWechatQrStatusMutation() {
  const refresh = useRefreshImStatus();
  return useMutation({
    mutationFn: (qrcode: string) => imApi.pollWechatQrStatus(qrcode),
    onSuccess: (result) => {
      if (result.status === "confirmed") refresh();
    },
  });
}

export function useDisconnectWechatMutation() {
  const refresh = useRefreshImStatus();
  return useMutation({
    mutationFn: () => imApi.disconnectWechat(),
    onSettled: refresh,
  });
}

export function useStartRemoteAccessMutation() {
  const refresh = useRefreshImStatus();
  return useMutation({ mutationFn: () => imApi.startRemoteAccess(), onSettled: refresh });
}

export function useStopRemoteAccessMutation() {
  const refresh = useRefreshImStatus();
  return useMutation({ mutationFn: () => imApi.stopRemoteAccess(), onSettled: refresh });
}

export function useForgetConversationMutation() {
  const refresh = useRefreshImStatus();
  return useMutation({
    mutationFn: (conversationKey: string) => imApi.forgetConversation(conversationKey),
    onSettled: refresh,
  });
}
