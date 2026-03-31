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
  const [extracting, setExtracting] = useState(false);
  const [extractingMsg, setExtractingMsg] = useState("");
  
  const fileRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const isValidKey = apiKey.startsWith("sk-or-");

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

  const extractPdfNative = useCallback(async (file: File) => {
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
    return { text: result.trim(), pdf };
  }, []);

  const extractPdfOcr = useCallback(async (pdf: any) => {
    setExtractingMsg("📷 Detected image-based PDF, running OCR...");
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js", "tesseract");
    const w = window as any;
    const worker = await w.Tesseract.createWorker("eng");
    let result = "";
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;

    for (let i = 1; i <= pdf.numPages; i++) {
      setExtractingMsg(`📷 OCR processing page ${i} of ${pdf.numPages}...`);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const { data: { text } } = await worker.recognize(canvas);
      result += text + "\n\n";
    }

    await worker.terminate();
    return result.trim();
  }, []);

  const extractPdf = useCallback(async (file: File) => {
    setExtractingMsg("📄 Extracting text...");
    const { text, pdf } = await extractPdfNative(file);

    if (text.length >= 50) {
      return text;
    }

    // Fallback to OCR
    try {
      const ocrText = await extractPdfOcr(pdf);
      if (ocrText && ocrText.trim().length > 0) {
        return ocrText;
      }
    } catch (ocrErr) {
      console.error("OCR failed:", ocrErr);
    }

    return text; // return whatever we got
  }, [extractPdfNative, extractPdfOcr]);

  const extractWord = useCallback(async (file: File) => {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js", "mammoth");
    const buf = await file.arrayBuffer();
    const result = await (window as any).mammoth.extractRawText({ arrayBuffer: buf });
    return result.value;
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setFileName(file.name);
      setExtracting(true);
      setText("");
      try {
        if (tab === "pdf") {
          if (!file.name.toLowerCase().endsWith(".pdf")) {
            toast({ title: "Please upload a PDF file", variant: "destructive" });
            return;
          }
          const extracted = await extractPdf(file);
          if (!extracted || !extracted.trim()) {
            toast({ title: "Could not extract text from this PDF. It may be a scanned image.", variant: "destructive" });
            return;
          }
          setText(extracted);
          toast({ title: `PDF extracted successfully — ${extracted.split(/\s+/).length} words` });
        } else {
          if (!/\.(docx?)$/i.test(file.name)) {
            toast({ title: "Please upload a Word document (.doc/.docx)", variant: "destructive" });
            return;
          }
          const extracted = await extractWord(file);
          if (!extracted || !extracted.trim()) {
            toast({ title: "Could not extract text from this document.", variant: "destructive" });
            return;
          }
          setText(extracted);
          toast({ title: "Word doc extracted successfully" });
        }
      } catch (err: any) {
        console.error("File extraction error:", err);
        toast({ title: "Failed to extract text from file", description: err?.message || "Unknown error", variant: "destructive" });
      } finally {
        setExtracting(false);
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
      toast({ title: "⚠️ Please enter your OpenRouter API key first!", variant: "destructive" });
      return;
    }

    setLoading(true);
    setOutput("");

const MODEL = "openrouter/auto";

    const requestBody = {
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Style: ${STYLE_CONTEXT[style]}\n\nHere is the document to transform:\n\n${text}` },
      ],
      max_tokens: 4096,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": window.location.origin,
      "X-Title": "NoteReel",
    };

    const tryStreaming = async () => {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...requestBody, stream: true }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`API error ${res.status}: ${err}`);
      }

      if (!res.body) {
        throw new Error("NO_STREAM_SUPPORT");
      }

      const reader = res.body.getReader();
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
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullOutput += delta;
              setOutput(fullOutput);
            }
          } catch {
            // skip partial JSON
          }
        }
      }

      if (!fullOutput) {
        throw new Error("NO_STREAM_SUPPORT");
      }
    };

    const tryNonStreaming = async () => {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers,
        body: JSON.stringify({ ...requestBody, stream: false }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`API error ${res.status}: ${err}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "";
      if (!content) throw new Error("No content in response");
      setOutput(content);
    };

    try {
      await tryStreaming();
    } catch (streamErr: any) {
      if (streamErr.message === "NO_STREAM_SUPPORT") {
        try {
          await tryNonStreaming();
        } catch (e: any) {
          toast({ title: "Generation failed", description: e.message, variant: "destructive" });
        }
      } else {
        toast({ title: "Generation failed", description: streamErr.message, variant: "destructive" });
      }
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
              🎬
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
          <label className="mb-1.5 block text-sm font-medium text-muted-foreground">OpenRouter API Key</label>
          <div className="relative">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-..."
              className="w-full rounded-lg border border-input bg-card px-4 py-2.5 pr-10 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
            />
            {isValidKey && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500">✅</span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Your key is never stored or sent anywhere.
            <br />
            Get a free key at{" "}
            <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" className="text-primary underline">openrouter.ai</a>
            {" "}— no credit card needed!
          </p>
          <button
            onClick={() => setShowKeyHelp(!showKeyHelp)}
            className="mt-1 text-xs font-medium text-primary hover:underline"
          >
            {showKeyHelp ? "Hide steps ↑" : "How do I get a key? →"}
          </button>
          {showKeyHelp && (
            <ol className="mt-2 ml-4 list-decimal text-xs text-muted-foreground space-y-1">
              <li>Go to <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" className="text-primary underline">openrouter.ai</a> and sign up</li>
              <li>Click "Keys" in the dashboard</li>
              <li>Click "Create Key" and name it anything</li>
              <li>Copy the key — it starts with sk-or-...</li>
              <li>Paste it above and you're ready 🎉</li>
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
            disabled={loading || extracting || !text.trim() || !apiKey.trim()}
            className="w-full rounded-lg bg-primary py-3.5 font-display font-bold text-primary-foreground transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            style={loading ? { animation: "pulse-glow 2s infinite" } : {}}
          >
            {extracting ? "📄 Extracting text..." : loading ? "🎬 Generating..." : "🎬 Generate Study Notes"}
          </button>
          {!loading && !extracting && (!text.trim() || !apiKey.trim()) && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {!apiKey.trim() && !text.trim()
                ? "Enter your API key and provide some text to get started"
                : !apiKey.trim()
                ? "Enter your OpenRouter API key above to continue"
                : "Upload a file or paste text above to continue"}
            </p>
          )}
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
