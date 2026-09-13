import { redirect } from "next/navigation";
import { getDealerConnection } from "@/actions/dealer";
import { isCurrentUserSuperAdmin } from "@/actions/settings";
import {
  ORDER_ENTRY_NEW_ORDER_PATH,
  ORDER_ENTRY_RECONNECT_PATH,
  forceExpiredFromParam,
  orderEntryLandingPath,
  withForceDealerExpiredQuery,
} from "@/lib/agent-connection";

export default async function OrderEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const forceExpired = forceExpiredFromParam(params.forceDealerExpired);
  if (forceExpired) {
    redirect(withForceDealerExpiredQuery(ORDER_ENTRY_RECONNECT_PATH, true));
  }

  const superAdmin = await isCurrentUserSuperAdmin();
  if (superAdmin) {
    redirect(ORDER_ENTRY_NEW_ORDER_PATH);
  }

  const result = await getDealerConnection();
  const data = result.data;
  redirect(
    orderEntryLandingPath({
      forceExpired: false,
      connected: data?.connected,
      sessionExpiresAt: data?.sessionExpiresAt,
      lastConnectedAt: data?.lastConnectedAt,
    }),
  );
}
