import { create } from "zustand";
import type { OrgRole, OrgMemberStatus } from "@devscope/shared";

interface CurrentTeam {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
}

interface TeamState {
  currentTeam: CurrentTeam | null;
  currentRole: OrgRole | null;
  members: OrgMemberStatus[];
  loading: boolean;

  setCurrentTeam: (team: CurrentTeam | null) => void;
  setCurrentRole: (role: OrgRole | null) => void;
  setMembers: (members: OrgMemberStatus[]) => void;
  setLoading: (loading: boolean) => void;

  isAdmin: () => boolean;
  isOwner: () => boolean;
}

export const useTeamStore = create<TeamState>((set, get) => ({
  currentTeam: null,
  currentRole: null,
  members: [],
  loading: true,

  setCurrentTeam: (team) => set({ currentTeam: team }),
  setCurrentRole: (role) => set({ currentRole: role }),
  setMembers: (members) => set({ members }),
  setLoading: (loading) => set({ loading }),

  isAdmin: () => {
    const role = get().currentRole;
    return role === "admin" || role === "owner";
  },
  isOwner: () => get().currentRole === "owner",
}));

// Preserve store state across Vite HMR (tree-shaken in production)
if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    const state = useTeamStore.getState();
    data.state = Object.fromEntries(
      Object.entries(state).filter(([, v]) => typeof v !== "function")
    );
  });
  if (import.meta.hot.data.state) {
    useTeamStore.setState(import.meta.hot.data.state);
  }
}
