import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

export type Persona = "technical" | "non-technical";

interface PersonaContextValue {
  persona: Persona | null;
  setPersona: (p: Persona) => void;
  clearPersona: () => void;
}

const STORAGE_KEY = "devscope_persona";

const PersonaCtx = createContext<PersonaContextValue | null>(null);

function readStored(): Persona | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "technical" || v === "non-technical") return v;
  } catch {
    /* SSR / private browsing */
  }
  return null;
}

export function PersonaProvider({ children }: { children: ReactNode }) {
  const [persona, setPersonaState] = useState<Persona | null>(readStored);

  const setPersona = useCallback((p: Persona) => {
    localStorage.setItem(STORAGE_KEY, p);
    setPersonaState(p);
  }, []);

  const clearPersona = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setPersonaState(null);
  }, []);

  return (
    <PersonaCtx.Provider value={{ persona, setPersona, clearPersona }}>
      {children}
    </PersonaCtx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function usePersona() {
  const ctx = useContext(PersonaCtx);
  if (!ctx) throw new Error("usePersona must be used inside PersonaProvider");
  return ctx;
}
