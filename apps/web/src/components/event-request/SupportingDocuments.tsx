"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, FileText } from "lucide-react";

import { uploadFile } from "@/lib/events";
import {
  listRequestAttachments, registerRequestAttachment, requestAttachmentUpload, type RequestAttachment,
} from "@/lib/requestAttachments";

const LOAD_FAILED = "We couldn't load the documents. Please try again.";

/** A readable size, such as "1.5 MB". */
const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// SCRUM-51: supporting documents on an event request that is still a draft. AC1: choose files, they are uploaded and listed
// with the request.
export function SupportingDocuments({ eventId }: { eventId: string }) {
  const [files, setFiles] = useState<RequestAttachment[]>();
  const [messages, setMessages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { ok, data } = await listRequestAttachments(eventId);
    if (ok) setFiles(data.attachments);
    else setMessages([LOAD_FAILED]);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function attach(file: File): Promise<string | undefined> {
    const prepared = await requestAttachmentUpload(eventId, file);
    if (!prepared.ok) return `${file.name}: ${prepared.data.error ?? "We couldn't attach it."}`;
    if (!(await uploadFile(prepared.data.upload_url, file))) return `We couldn't upload ${file.name}. Please try again.`;
    const registered = await registerRequestAttachment(eventId, file, prepared.data.storage_path);
    if (!registered.ok) return `${file.name}: ${registered.data.error ?? "We couldn't attach it."}`;
    return undefined;
  }

  async function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = [...(e.target.files ?? [])];
    e.target.value = ""; // so choosing the same file again still fires
    setMessages([]);
    setBusy(true);
    const problems: string[] = [];
    for (const file of chosen) {
      const problem = await attach(file);
      if (problem) problems.push(problem);
    }
    await load();
    setMessages((shown) => [...shown, ...problems]);
    setBusy(false);
  }

  return (
    <section aria-labelledby="supporting-documents-title" className="flex flex-col gap-3">
      <h3 id="supporting-documents-title" className="text-base font-bold text-foreground">Supporting documents</h3>

      {messages.map((m) => (
        <p key={m} role="alert" className="flex items-center gap-2 rounded-lg bg-status-danger p-3 text-sm font-medium text-status-danger-fg">
          <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
          {m}
        </p>
      ))}

      {files === undefined ? null : files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents attached yet.</p>
      ) : (
        <ul aria-label="Supporting documents" className="flex flex-col divide-y divide-border rounded-lg ring-1 ring-foreground/10">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 p-3 text-sm">
              <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{f.file_name}</span>
              <span className="text-muted-foreground">{sizeText(f.size_bytes)}</span>
            </li>
          ))}
        </ul>
      )}

      <label htmlFor="supporting-documents-input" className="text-sm font-semibold text-foreground">Add documents</label>
      <input id="supporting-documents-input" type="file" multiple disabled={busy} onChange={choose}
        className="text-sm text-foreground file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-border-strong file:bg-card file:px-3 file:py-2 file:text-sm file:font-semibold" />
    </section>
  );
}
