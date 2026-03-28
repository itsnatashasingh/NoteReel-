import { useState, useRef, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

// CDN script loader
function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) return resolve();
    const s = document.createElement("script");
    s.id = id;
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

const SYSTEM_PROMPT = `You are NoteReel, an intelligent study assistant that transforms documents,
PDFs, and text into engaging notes that feel like a YouTube study video transcript.
Your job is to read any document the user provides and produce output that mimics
the tone, structure, and energy of a popular educational YouTube video — think
channels like CrashCourse, Ali Abdaal, or Kurzgesagt.

## YOUR OUTPUT STYLE
- Open with a hook, just like a YouTuber would: grab attention in the first 2-3 lines.
- Use a warm, conversational, enthusiastic tone throughout — never dry or robotic.
- Break content into clearly labelled sections, e.g.:
    Intro / Hook
    Core Concept #1
    Deep Dive — Key Details
    Real-World Example or Analogy
    Quick Recap
    Outro / What to study next
- Use analogies and simple examples to explain complex ideas.
- Add occasional in-video callouts like:
    "📌 Pro tip: ..."
    "⚡ Key takeaway: ..."
    "🔁 Quick recap before we move on..."
    "👇 Pause here and test yourself: ..."
- End with a summary section and 2-3 suggested next video topics.

## NOTES FORMAT
After the video-style transcript, also produce a clean bullet-point notes section:
    ### 📝 Study Notes
    - Key point 1
    - Key point 2

## RULES
- Always preserve factual accuracy — never add information not present in the source.
- Adjust depth based on document length.
- Never use jargon without immediately explaining it in plain English.`;

type Style = "chill" | "energy" | "academic";
type InputTab = "text" | "pdf" | "word";

const STYLES: { key: Style; emoji: string; label: string; desc: string }[] = [
  { key: "chill", emoji: "😌", label: "Chill", desc: "Calm & conversational" },
  { key: "energy", emoji: "⚡", label: "High Energy", desc: "Fast-paced & exciting" },
  { key: "academic", emoji: "🎓", label: "Academic", desc: "Deep & structured" },
];

const STYLE_CONTEXT: Record<Style, string> = {
  chill: "Use a calm, relaxed, conversational tone — like a chill study-with-me YouTuber.",
  energy: "Use a fast-paced, exciting, high-energy tone — like a CrashCourse or Kurzgesagt video!",
  academic: "Use a deep, structured, academic tone — thorough and methodical like a university lecture.",
};

export default function Index() {
  const [dark, setDark] = useState(true);
  const [tab, setTab] = useState<InputTab>("text");
  const [style, setStyle] = useState<Style>("energy");
  const [text, setText] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [showKeyHelp, setShowKeyHelp] = useState(false);
  
  const fileRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const isValidKey = apiKey.startsWith("sk-ant");

  // Auto-collapse helper when valid key entered
  useEffect(() => {
    if (isValidKey) {
      setShowKeyHelp(false);
    }
  }, [isValidKey]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // Initialize dark mode
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const extractPdf = useCallback(async (file: File) => {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", "pdfjs");
    const w = window as any;
    w.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const buf = await file.arrayBuffer();
    const pdf = await w.pdfjsLib.getDocument({ data: buf }).promise;
    let result = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      result += content.items.map((item: any) => item.str).join(" ") + "\n\n";
    }
    return result.trim();
  }, []);

  const extractWord = useCallback(async (file: File) => {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js", "mammoth");
    const buf = await file.arrayBuffer();
    const result = await (window as any).mammoth.extractRawText({ arrayBuffer: buf });
    return result.value;
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setFileName(file.name);
      try {
        if (tab === "pdf") {
          if (!file.name.toLowerCase().endsWith(".pdf")) {
            toast({ title: "Please upload a PDF file", variant: "destructive" });
            return;
          }
          const extracted = await extractPdf(file);
          setText(extracted);
          toast({ title: "PDF extracted successfully" });
        } else {
          if (!/\.(docx?)$/i.test(file.name)) {
            toast({ title: "Please upload a Word document (.doc/.docx)", variant: "destructive" });
            return;
          }
          const extracted = await extractWord(file);
          setText(extracted);
          toast({ title: "Word doc extracted successfully" });
        }
      } catch {
        toast({ title: "Failed to extract text from file", variant: "destructive" });
      }
    },
    [tab, extractPdf, extractWord, toast]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const generate = useCallback(async () => {
    if (!text.trim()) {
      toast({ title: "Please provide some text first", variant: "destructive" });
      return;
    }
    if (!apiKey.trim()) {
      toast({ title: "Please enter your Anthropic API key", variant: "destructive" });
      return;
    }

    setLoading(true);
    setOutput("");

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          stream: true,
          messages: [
            {
              role: "user",
              content: `Style: ${STYLE_CONTEXT[style]}\n\nHere is the document to transform:\n\n${text}`,
            },
          ],
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`API error ${res.status}: ${err}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullOutput = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6);
          if (json === "[DONE]") break;
          try {
            const parsed = JSON.parse(json);
            if (parsed.type === "content_block_delta" && parsed.delta?.text) {
              fullOutput += parsed.delta.text;
              setOutput(fullOutput);
            }
          } catch {
            // skip partial JSON
          }
        }
      }
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [text, apiKey, style, toast]);

  const copyOutput = useCallback(() => {
    navigator.clipboard.writeText(output);
    toast({ title: "Copied to clipboard! 📋" });
  }, [output, toast]);

  const downloadPdf = useCallback(async () => {
    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", "jspdf");
      const { jsPDF } = (window as any).jspdf;
      const doc = new jsPDF();
      const lines = doc.splitTextToSize(output, 170);
      let y = 20;
      for (const line of lines) {
        if (y > 280) {
          doc.addPage();
          y = 20;
        }
        doc.text(line, 20, y);
        y += 7;
      }
      doc.save("NoteReel-notes.pdf");
      toast({ title: "PDF downloaded! 📄" });
    } catch {
      toast({ title: "Failed to generate PDF", variant: "destructive" });
    }
  }, [output, toast]);

  const renderMarkdown = (md: string) => {
    // Simple markdown renderer
    return md.split("\n").map((line, i) => {
      if (line.startsWith("### ")) return <h3 key={i} className="text-lg font-display font-bold text-primary mt-6 mb-2">{line.slice(4)}</h3>;
      if (line.startsWith("## ")) return <h2 key={i} className="text-xl font-display font-bold text-primary mt-8 mb-3">{line.slice(3)}</h2>;
      if (line.startsWith("# ")) return <h1 key={i} className="text-2xl font-display font-bold text-primary mt-8 mb-3">{line.slice(2)}</h1>;
      if (line.startsWith("- ")) return <li key={i} className="ml-4 list-disc text-foreground/90">{line.slice(2)}</li>;
      if (line.startsWith("**") && line.endsWith("**")) return <p key={i} className="font-bold text-foreground mt-2">{line.slice(2, -2)}</p>;
      if (line.trim() === "") return <br key={i} />;
      // Inline bold
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      return (
        <p key={i} className="text-foreground/85 leading-relaxed">
          {parts.map((part, j) =>
            part.startsWith("**") && part.endsWith("**") ? (
              <strong key={j} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>
            ) : (
              part
            )
          )}
        </p>
      );
    });
  };

  const tabItems: { key: InputTab; label: string; icon: string }[] = [
    { key: "text", label: "Paste Text", icon: "📝" },
    { key: "pdf", label: "PDF Upload", icon: "📄" },
    { key: "word", label: "Word Doc", icon: "📃" },
  ];

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-lg">
              🔍
            </div>
            <h1 className="font-display text-xl font-bold text-foreground">NoteReel</h1>
          </div>
          <button
            onClick={() => setDark(!dark)}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Toggle theme"
          >
            {dark ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {/* Hero */}
        <div className="fade-up mb-10 text-center">
          <h2 className="font-display text-3xl font-bold text-foreground sm:text-4xl">
            Transform docs into{" "}
            <span className="text-primary">YouTube-style</span> study notes
          </h2>
          <p className="mt-3 text-muted-foreground">
            Upload a PDF, Word doc, or paste text — get engaging video-style notes powered by AI.
          </p>
        </div>

        {/* API Key */}
        <div className="fade-up fade-up-delay-1 mb-6">
          <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Anthropic API Key</label>
          <div className="relative">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full rounded-lg border border-input bg-card px-4 py-2.5 pr-10 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
            />
            {isValidKey && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500">✅</span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Your key is never stored or sent anywhere.
            <br />
            Don't have a key? Follow these steps to get one free:
          </p>
          <button
            onClick={() => setShowKeyHelp(!showKeyHelp)}
            className="mt-1 text-xs font-medium text-primary hover:underline"
          >
            {showKeyHelp ? "Hide steps ↑" : "How do I get a key? →"}
          </button>
          {showKeyHelp && (
            <ol className="mt-2 ml-4 list-decimal text-xs text-muted-foreground space-y-1">
              <li>Go to <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">console.anthropic.com</a> and sign up</li>
              <li>Click "API Keys" in the left sidebar</li>
              <li>Click "Create Key", name it anything, and hit create</li>
              <li>Copy the key immediately — it's only shown once!</li>
              <li>Paste it in the box above and you're ready 🎉</li>
            </ol>
          )}
        </div>

        {/* Input Tabs */}
        <div className="fade-up fade-up-delay-1 mb-6">
          <div className="mb-3 flex gap-1 rounded-lg bg-muted p-1">
            {tabItems.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTab(t.key);
                  setText("");
                  setFileName("");
                }}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-all ${
                  tab === t.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {tab === "text" ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your lecture notes, article, or any text here..."
              rows={8}
              className="w-full resize-none rounded-lg border border-input bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
            />
          ) : (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={`flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-all ${
                dragOver
                  ? "border-primary bg-primary/10"
                  : "border-input bg-card hover:border-primary/50"
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                accept={tab === "pdf" ? ".pdf" : ".doc,.docx"}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <span className="text-4xl mb-3">{tab === "pdf" ? "📄" : "📃"}</span>
              {fileName ? (
                <p className="text-foreground font-medium">{fileName}</p>
              ) : (
                <>
                  <p className="text-foreground font-medium">
                    Drop your {tab === "pdf" ? "PDF" : "Word doc"} here
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
                </>
              )}
              {text && (
                <p className="mt-3 text-xs text-muted-foreground">
                  ✅ Extracted {text.split(/\s+/).length} words
                </p>
              )}
            </div>
          )}
        </div>

        {/* Style Selector */}
        <div className="fade-up fade-up-delay-2 mb-6">
          <label className="mb-2 block text-sm font-medium text-muted-foreground">Video Style</label>
          <div className="grid grid-cols-3 gap-3">
            {STYLES.map((s) => (
              <button
                key={s.key}
                onClick={() => setStyle(s.key)}
                className={`rounded-lg border-2 px-4 py-3 text-left transition-all ${
                  style === s.key
                    ? "border-primary bg-primary/10 shadow-sm"
                    : "border-input bg-card hover:border-primary/30"
                }`}
              >
                <span className="text-xl">{s.emoji}</span>
                <p className="mt-1 font-display font-semibold text-foreground text-sm">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Generate Button */}
        <div className="fade-up fade-up-delay-3 mb-8">
          <button
            onClick={generate}
            disabled={loading || !text.trim() || !apiKey.trim()}
            className="w-full rounded-lg bg-primary py-3.5 font-display font-bold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            style={loading ? { animation: "pulse-glow 2s infinite" } : {}}
          >
            {loading ? "🔍 Generating..." : "🔍 Generate Study Notes"}
          </button>
        </div>

        {/* Output */}
        {(output || loading) && (
          <div className="fade-up mb-12">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-display font-bold text-foreground text-lg">📺 Your Study Notes</h3>
              {output && !loading && (
                <div className="flex gap-2">
                  <button
                    onClick={copyOutput}
                    className="rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/80 transition-colors"
                  >
                    📋 Copy
                  </button>
                  <button
                    onClick={downloadPdf}
                    className="rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/80 transition-colors"
                  >
                    📥 PDF
                  </button>
                </div>
              )}
            </div>
            <div
              ref={outputRef}
              className="rounded-lg border border-border bg-card p-6 prose-sm max-w-none space-y-1"
            >
              {output ? renderMarkdown(output) : (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
                  Thinking...
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
