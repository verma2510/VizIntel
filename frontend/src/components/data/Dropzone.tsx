import React, { useRef, useState } from "react";
import { CloudUpload, FileSpreadsheet } from "lucide-react";
import { MAX_UPLOAD_MB } from "../../lib/upload";

export const Dropzone: React.FC<{ onFile: (file: File) => void; disabled?: boolean; compact?: boolean; className?: string }> = ({ onFile, disabled, compact, className = "" }) => {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      className={`group relative flex flex-col items-center justify-center rounded-xl border border-dashed text-center transition-colors ${
        dragging ? "border-brand bg-brand-soft" : "border-line-strong bg-surface-2 hover:border-brand/60 hover:bg-surface"
      } ${compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-12"} ${disabled ? "pointer-events-none opacity-60" : ""} ${className}`}
    >
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
        disabled={disabled}
        data-track="upload_dataset"
        aria-label="Choose a CSV or Excel file to upload"
      />
      <div className={`flex items-center justify-center rounded-xl border border-line bg-surface shadow-card-sm transition-transform group-hover:-translate-y-0.5 ${compact ? "h-10 w-10" : "h-12 w-12"}`}>
        {dragging ? <FileSpreadsheet className="text-brand" size={22} /> : <CloudUpload className="text-ink-2" size={22} />}
      </div>
      <div>
        <p className="text-sm font-medium text-ink">
          {dragging ? "Drop to upload" : (
            <>
              Drag a file here or <span className="text-brand-ink underline-offset-2 group-hover:underline">browse</span>
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-ink-3">CSV or Excel · up to {MAX_UPLOAD_MB} MB · first sheet is analyzed</p>
      </div>
    </div>
  );
};
