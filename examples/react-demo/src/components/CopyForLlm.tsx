import { useState } from "react";
import { Bot, Check } from "lucide-react";
// The repo's llm.md, inlined at build time. One source: the file shipped
// with the package is the file this button copies.
import LLM_MD from "../../../../llm.md?raw";
import { Button } from "@/components/ui/button";

/**
 * Copies a brief written for an LLM, not for a person: the model, the API
 * surface and the performance rules, dense and without marketing. Paste it
 * into a chat before asking for code against this package.
 */
export function CopyForLlm() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(LLM_MD);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={copy}
      data-testid="copy-llm"
      aria-label="Copy a brief about this package for an LLM"
    >
      {copied ? <Check className="size-4 text-emerald-500" /> : <Bot className="size-4" />}
    </Button>
  );
}
