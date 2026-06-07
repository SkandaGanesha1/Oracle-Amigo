import type { FC } from "react";
import { SessionBanner } from "../auth/SessionBanner";
import { AdminRouter } from "./AdminRouter";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import type { SessionState } from "../auth/useSession";

interface Props {
  session: SessionState;
}

export const AdminLayout: FC<Props> = ({ session }) => (
  <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0c]/95 text-white shadow-2xl">
    <SessionBanner session={session} />
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <Sidebar />
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-h-0 flex-1 overflow-auto p-4">
          <AdminRouter />
        </main>
      </div>
    </div>
  </div>
);
