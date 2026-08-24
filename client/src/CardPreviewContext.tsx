import { createContext, useContext, useState, type ReactNode } from "react";
import type { Card } from "@draft-simulator/shared";

interface CardPreviewValue {
  hoveredCard: Card | null;
  setHoveredCard: (card: Card | null) => void;
}

const CardPreviewContext = createContext<CardPreviewValue | null>(null);

export function CardPreviewProvider({ children }: { children: ReactNode }) {
  const [hoveredCard, setHoveredCard] = useState<Card | null>(null);
  return <CardPreviewContext.Provider value={{ hoveredCard, setHoveredCard }}>{children}</CardPreviewContext.Provider>;
}

export function useCardPreview(): CardPreviewValue {
  const ctx = useContext(CardPreviewContext);
  if (!ctx) throw new Error("useCardPreview must be used within a CardPreviewProvider");
  return ctx;
}
