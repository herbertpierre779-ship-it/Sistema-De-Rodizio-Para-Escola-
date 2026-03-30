import { useContext } from "react";
import { FeedbackContext } from "../providers/FeedbackProvider";

export function useFeedback() {
  const context = useContext(FeedbackContext);

  if (!context) {
    throw new Error("useFeedback deve ser usado dentro de FeedbackProvider.");
  }

  return context;
}
