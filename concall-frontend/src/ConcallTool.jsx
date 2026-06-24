// import React, { useState, useCallback, useRef, useEffect } from "react";
// import * as XLSX from "xlsx";
// import jsPDF from "jspdf";
// import autoTable from "jspdf-autotable";

// // Backend base URL. Defaults to local dev; override at build time with
// // VITE_API_BASE_URL (Vite) or REACT_APP_API_BASE_URL (CRA) once deployed.
// const API_BASE_URL =
//   (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE_URL) ||
//   (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE_URL) ||
//   "http://localhost:8000";

// const DEFAULT_COLUMNS = [
//   "Company Name",
//   "Quarter and Year",
//   "Growth Guidance",
//   "Margin Guidance",
//   "Capex/Expansion",
//   "Order Book",
//   "Key Risk",
//   "Key Takeaway",
// ];

// const MAX_CONCURRENT = 3;

// const THEMES = {
//   light: {
//     bg: "#FAFAF8",
//     bgSubtle: "#F2F1EC",
//     panel: "#FFFFFF",
//     ink: "#13151A",
//     inkMuted: "#5B6B5E",
//     inkFaint: "#9B9D94",
//     accent: "#1F4D3D",
//     accentBg: "#E8F0EA",
//     rust: "#9B5B3E",
//     rustBg: "#F5E9E2",
//     hairline: "#E2E0D8",
//     hairlineStrong: "#C9C6B8",
//     headerBg: "#13151A",
//     headerInk: "#FAFAF8",
//   },
//   dark: {
//     bg: "#0D0F12",
//     bgSubtle: "#15171B",
//     panel: "#16181D",
//     ink: "#E8E6E0",
//     inkMuted: "#8B948C",
//     inkFaint: "#5C6259",
//     accent: "#3FAE85",
//     accentBg: "#16261F",
//     rust: "#D38A6C",
//     rustBg: "#2A1D17",
//     hairline: "#23262C",
//     hairlineStrong: "#33363D",
//     headerBg: "#0A0B0D",
//     headerInk: "#E8E6E0",
//   },
// };

// async function extractViaBackend(file, columns) {
//   const formData = new FormData();
//   formData.append("file", file);

//   const params = new URLSearchParams({ columns: columns.join(",") });

//   const response = await fetch(`${API_BASE_URL}/extract?${params.toString()}`, {
//     method: "POST",
//     body: formData,
//   });

//   if (!response.ok) {
//     let detail = `Request failed (${response.status})`;
//     try {
//       const errBody = await response.json();
//       if (errBody?.detail) detail = errBody.detail;
//     } catch (_) {
//       // response wasn't JSON — keep generic message
//     }
//     throw new Error(detail);
//   }

//   const data = await response.json();
//   return data.row || {};
// }

// const STATUS = {
//   QUEUED: "queued",
//   EXTRACTING: "extracting",
//   DONE: "done",
//   ERROR: "error",
// };

// // Most fields come back as { value, source_quote, source_page }; "Quarter
// // and Year" comes back as a plain string. These helpers handle both shapes
// // safely.
// function getCellValue(cellData) {
//   if (cellData == null) return "";
//   if (typeof cellData === "string") return cellData;
//   return cellData.value || "";
// }

// function getCellSource(cellData) {
//   if (cellData == null || typeof cellData === "string") return "";
//   return cellData.source_quote || "";
// }

// function getCellPage(cellData) {
//   if (cellData == null || typeof cellData === "string") return 0;
//   return cellData.source_page || 0;
// }

// export default function ConcallTool() {
//   const [theme, setTheme] = useState("light");
//   const t = THEMES[theme];

//   const [columns, setColumns] = useState(DEFAULT_COLUMNS);
//   const [editingColumns, setEditingColumns] = useState(false);
//   const [columnDraft, setColumnDraft] = useState(DEFAULT_COLUMNS.join(", "));
//   const [files, setFiles] = useState([]);
//   const [rows, setRows] = useState([]);
//   const [expandedRows, setExpandedRows] = useState(new Set());
//   const [isDragging, setIsDragging] = useState(false);
//   const [copyState, setCopyState] = useState("idle"); // idle | copied
//   const fileInputRef = useRef(null);
//   const idCounter = useRef(0);

//   // Tracks which file entries are currently queued/in-flight so the
//   // concurrency-limited runner below knows what's left to pick up.
//   const queueRef = useRef([]);
//   const activeWorkersRef = useRef(0);
//   const columnsRef = useRef(columns);
//   columnsRef.current = columns;

//   const addFiles = useCallback((fileList) => {
//     const pdfFiles = Array.from(fileList).filter((f) =>
//       f.name.toLowerCase().endsWith(".pdf")
//     );
//     const entries = pdfFiles.map((f) => ({
//       id: ++idCounter.current,
//       file: f,
//       name: f.name,
//       status: STATUS.QUEUED,
//       error: null,
//     }));
//     setFiles((prev) => [...prev, ...entries]);
//     return entries;
//   }, []);

//   const processOne = useCallback(async (entry) => {
//     setFiles((prev) =>
//       prev.map((f) => (f.id === entry.id ? { ...f, status: STATUS.EXTRACTING } : f))
//     );
//     try {
//       const rowData = await extractViaBackend(entry.file, columnsRef.current);
//       const rowId = ++idCounter.current;
//       setRows((prev) => [
//         ...prev,
//         { id: rowId, fileName: entry.name, data: rowData, mintedAt: Date.now() },
//       ]);
//       setFiles((prev) =>
//         prev.map((f) => (f.id === entry.id ? { ...f, status: STATUS.DONE } : f))
//       );
//     } catch (err) {
//       setFiles((prev) =>
//         prev.map((f) =>
//           f.id === entry.id ? { ...f, status: STATUS.ERROR, error: err.message } : f
//         )
//       );
//     }
//   }, []);

//   // Concurrency-limited runner: keeps up to MAX_CONCURRENT extractions
//   // in flight at once. As each one finishes, it immediately pulls the
//   // next queued entry, so a batch of N files completes in roughly
//   // N / MAX_CONCURRENT round-trips instead of N sequential ones.
//   const pump = useCallback(() => {
//     while (activeWorkersRef.current < MAX_CONCURRENT && queueRef.current.length > 0) {
//       const entry = queueRef.current.shift();
//       activeWorkersRef.current += 1;
//       processOne(entry).finally(() => {
//         activeWorkersRef.current -= 1;
//         pump();
//       });
//     }
//   }, [processOne]);

//   const processQueue = useCallback(
//     (entries) => {
//       queueRef.current.push(...entries);
//       pump();
//     },
//     [pump]
//   );

//   const handleFiles = useCallback(
//     (fileList) => {
//       const entries = addFiles(fileList);
//       if (entries.length > 0) processQueue(entries);
//     },
//     [addFiles, processQueue]
//   );

//   const onDrop = useCallback(
//     (e) => {
//       e.preventDefault();
//       setIsDragging(false);
//       handleFiles(e.dataTransfer.files);
//     },
//     [handleFiles]
//   );

//   const exportMarkdown = () => {
//     const header = `| ${columns.join(" | ")} |`;
//     const sep = `| ${columns.map(() => "---").join(" | ")} |`;
//     const body = rows
//       .map(
//         (r) =>
//           `| ${columns
//             .map((c) => getCellValue(r.data[c]).replace(/\|/g, "/"))
//             .join(" | ")} |`
//       )
//       .join("\n");
//     return [header, sep, body].join("\n");
//   };

//   const downloadBlob = (content, filename, mimeType) => {
//     const blob = new Blob([content], { type: mimeType });
//     const url = URL.createObjectURL(blob);
//     const a = document.createElement("a");
//     a.href = url;
//     a.download = filename;
//     document.body.appendChild(a);
//     a.click();
//     document.body.removeChild(a);
//     URL.revokeObjectURL(url);
//   };

//   const tableRowsAsStrings = () => rows.map((r) => columns.map((c) => getCellValue(r.data[c])));

//   const exportCSV = () => {
//     const escapeCell = (val) => `"${String(val).replace(/"/g, '""')}"`;
//     const header = columns.map(escapeCell).join(",");
//     const body = tableRowsAsStrings()
//       .map((row) => row.map(escapeCell).join(","))
//       .join("\n");
//     // \ufeff BOM so Excel opens UTF-8 CSVs (e.g. ₹, non-ASCII company names) correctly.
//     downloadBlob("\ufeff" + [header, body].join("\n"), "concall-ledger.csv", "text/csv;charset=utf-8;");
//   };

//   const exportExcel = () => {
//     const wsData = [columns, ...tableRowsAsStrings()];
//     const ws = XLSX.utils.aoa_to_sheet(wsData);
//     // Reasonable default column widths so cells aren't squashed on open.
//     ws["!cols"] = columns.map(() => ({ wch: 28 }));
//     const wb = XLSX.utils.book_new();
//     XLSX.utils.book_append_sheet(wb, ws, "Ledger");
//     XLSX.writeFile(wb, "concall-ledger.xlsx");
//   };

//   const exportPDF = () => {
//     const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
//     doc.setFontSize(14);
//     doc.text("Concalls.in — Management Guidance Tracker", 32, 28);
//     autoTable(doc, {
//       startY: 42,
//       head: [columns],
//       body: tableRowsAsStrings(),
//       styles: { fontSize: 7, cellPadding: 4, overflow: "linebreak" },
//       headStyles: { fillColor: [19, 21, 26] },
//       columnStyles: Object.fromEntries(columns.map((_, i) => [i, { cellWidth: "auto" }])),
//       margin: { left: 24, right: 24 },
//     });
//     doc.save("concall-ledger.pdf");
//   };

//   const toggleRowExpanded = (rowId) => {
//     setExpandedRows((prev) => {
//       const next = new Set(prev);
//       if (next.has(rowId)) next.delete(rowId);
//       else next.add(rowId);
//       return next;
//     });
//   };

//   const copyTable = async () => {
//     try {
//       await navigator.clipboard.writeText(exportMarkdown());
//       setCopyState("copied");
//       setTimeout(() => setCopyState("idle"), 1800);
//     } catch (_) {
//       /* clipboard unavailable in this context; fail silently */
//     }
//   };

//   const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));
//   const removeFile = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));
//   const retryFile = (entry) => {
//     setFiles((prev) =>
//       prev.map((f) => (f.id === entry.id ? { ...f, status: STATUS.QUEUED, error: null } : f))
//     );
//     processQueue([entry]);
//   };

//   const applyColumnEdit = () => {
//     const newCols = columnDraft.split(",").map((c) => c.trim()).filter(Boolean);
//     if (newCols.length > 0) setColumns(newCols);
//     setEditingColumns(false);
//   };

//   const activeCount = files.filter(
//     (f) => f.status === STATUS.EXTRACTING || f.status === STATUS.QUEUED
//   ).length;

//   // Fields excluded from the expandable "source" panel — these either
//   // have no meaningful citation (Quarter and Year is normalized, not
//   // quoted) or are intentionally omitted from sourcing per product choice
//   // (Company Name).
//   const NON_CITABLE_FIELDS = ["Quarter and Year", "Company Name"];

//   return (
//     <div
//       style={{
//         minHeight: "100vh",
//         background: t.bg,
//         color: t.ink,
//         fontFamily: "'Inter', -apple-system, sans-serif",
//         transition: "background 0.25s ease, color 0.25s ease",
//       }}
//     >
//       <style>{`
//         @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
//         * { box-sizing: border-box; }
//         .display { font-family: 'Fraunces', serif; font-optical-sizing: auto; }
//         .mono { font-family: 'JetBrains Mono', monospace; }
//         button { font-family: inherit; }
//         button:focus-visible, input:focus-visible, textarea:focus-visible {
//           outline: 2px solid ${t.accent};
//           outline-offset: 2px;
//         }
//         .dropzone { transition: border-color 0.18s ease, background 0.18s ease; }

//         @keyframes printIn {
//           from { clip-path: inset(0 100% 0 0); opacity: 0.4; }
//           to   { clip-path: inset(0 0% 0 0); opacity: 1; }
//         }
//         .print-in { animation: printIn 0.55s cubic-bezier(0.16, 1, 0.3, 1); }

//         @keyframes markHighlight {
//           0%   { background-size: 0% 100%; }
//           100% { background-size: 100% 100%; }
//         }
//         .takeaway-mark {
//           background-image: linear-gradient(180deg, transparent 62%, var(--mark-color) 62%);
//           background-repeat: no-repeat;
//           background-size: 0% 100%;
//           animation: markHighlight 0.5s ease-out 0.5s forwards;
//         }

//         @keyframes softPulse {
//           0%, 100% { opacity: 1; }
//           50% { opacity: 0.35; }
//         }
//         .pulse { animation: softPulse 1.3s ease-in-out infinite; }

//         @keyframes spin { to { transform: rotate(360deg); } }
//         .spinner { animation: spin 0.8s linear infinite; }

//         @media (prefers-reduced-motion: reduce) {
//           .print-in, .takeaway-mark, .pulse, .spinner { animation: none !important; background-size: 100% 100% !important; }
//         }

//         .scrollbox::-webkit-scrollbar { height: 8px; width: 8px; }
//         .scrollbox::-webkit-scrollbar-thumb { background: ${t.hairlineStrong}; border-radius: 4px; }

//         .icon-btn { transition: opacity 0.15s ease, background 0.15s ease; }
//         .icon-btn:hover { opacity: 1 !important; }

//         @media (max-width: 720px) {
//           .header-row { flex-direction: column; align-items: flex-start !important; gap: 14px; }
//           .toolbar-row { flex-direction: column; align-items: stretch !important; }
//           .toolbar-row > div:last-child { align-self: flex-end; }
//         }
//       `}</style>

//       {/* Top bar */}
//       <div
//         style={{
//           background: t.headerBg,
//           color: t.headerInk,
//           borderBottom: `1px solid ${t.hairlineStrong}`,
//         }}
//       >
//         <div
//           className="header-row"
//           style={{
//             maxWidth: "1800px",
//             margin: "0 auto",
//             padding: "22px 32px",
//             display: "flex",
//             justifyContent: "space-between",
//             alignItems: "center",
//           }}
//         >
//           <div style={{ display: "flex", alignItems: "baseline", gap: "14px" }}>
//             <span
//               className="display"
//               style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em" }}
//             >
//               Ledger
//             </span>
//             <span
//               className="mono"
//               style={{
//                 fontSize: "10.5px",
//                 letterSpacing: "0.14em",
//                 opacity: 0.55,
//                 textTransform: "uppercase",
//               }}
//             >
//               Concall Insight Extractor
//             </span>
//           </div>

//           <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
//             <span className="mono" style={{ fontSize: "11.5px", opacity: 0.6 }}>
//               {rows.length} extracted
//               {activeCount > 0
//                 ? ` · ${activeCount} in queue (up to ${MAX_CONCURRENT} at once)`
//                 : ""}
//             </span>
//             <button
//               onClick={() => setTheme(theme === "light" ? "dark" : "light")}
//               aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
//               style={{
//                 background: "transparent",
//                 border: `1px solid ${theme === "light" ? "rgba(250,250,248,0.25)" : t.hairlineStrong}`,
//                 borderRadius: "20px",
//                 padding: "5px 12px 5px 5px",
//                 display: "flex",
//                 alignItems: "center",
//                 gap: "8px",
//                 cursor: "pointer",
//                 color: t.headerInk,
//               }}
//             >
//               <span
//                 style={{
//                   width: "18px",
//                   height: "18px",
//                   borderRadius: "50%",
//                   background: theme === "light" ? "#F2C14E" : "#3FAE85",
//                   display: "inline-block",
//                 }}
//               />
//               <span className="mono" style={{ fontSize: "11px" }}>
//                 {theme === "light" ? "Light" : "Dark"}
//               </span>
//             </button>
//           </div>
//         </div>
//       </div>

//       <div className="main-content" style={{ maxWidth: "1800px", margin: "0 auto", padding: "36px 48px 72px" }}>
//         {/* Intro line */}
//         <p
//           className="display"
//           style={{
//             fontSize: "26px",
//             fontWeight: 500,
//             lineHeight: 1.35,
//             margin: "0 0 28px",
//             maxWidth: "640px",
//             color: t.ink,
//           }}
//         >
//           The transcript is 50 pages. Management declares it in one line. We track it every quarter.
//         </p>

//         {/* Column config */}
//         <div
//           className="toolbar-row"
//           style={{
//             display: "flex",
//             justifyContent: "space-between",
//             alignItems: "center",
//             marginBottom: "18px",
//             paddingBottom: "18px",
//             borderBottom: `1px solid ${t.hairline}`,
//           }}
//         >
//           {!editingColumns ? (
//             <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
//               <span
//                 className="mono"
//                 style={{ fontSize: "10.5px", color: t.inkFaint, letterSpacing: "0.1em", marginRight: "4px" }}
//               >
//                 FIELDS
//               </span>
//               {columns.map((c) => (
//                 <span
//                   key={c}
//                   className="mono"
//                   style={{
//                     fontSize: "11.5px",
//                     color: t.inkMuted,
//                     background: t.bgSubtle,
//                     border: `1px solid ${t.hairline}`,
//                     borderRadius: "4px",
//                     padding: "4px 9px",
//                   }}
//                 >
//                   {c}
//                 </span>
//               ))}
//               <button
//                 onClick={() => {
//                   setColumnDraft(columns.join(", "));
//                   setEditingColumns(true);
//                 }}
//                 style={{
//                   background: "none",
//                   border: "none",
//                   color: t.accent,
//                   fontSize: "12px",
//                   fontWeight: 600,
//                   cursor: "pointer",
//                   padding: "4px 6px",
//                 }}
//               >
//                 Edit fields →
//               </button>
//             </div>
//           ) : (
//             <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", flexWrap: "wrap", width: "100%" }}>
//               <textarea
//                 value={columnDraft}
//                 onChange={(e) => setColumnDraft(e.target.value)}
//                 rows={2}
//                 style={{
//                   flex: "1 1 400px",
//                   minWidth: "260px",
//                   padding: "9px 11px",
//                   border: `1px solid ${t.hairlineStrong}`,
//                   borderRadius: "6px",
//                   fontFamily: "'JetBrains Mono', monospace",
//                   fontSize: "12px",
//                   resize: "vertical",
//                   background: t.panel,
//                   color: t.ink,
//                 }}
//                 placeholder="Comma-separated field names"
//               />
//               <button
//                 onClick={applyColumnEdit}
//                 style={{
//                   background: t.accent,
//                   color: t.bg,
//                   border: "none",
//                   borderRadius: "6px",
//                   padding: "10px 18px",
//                   fontWeight: 600,
//                   fontSize: "13px",
//                   cursor: "pointer",
//                 }}
//               >
//                 Apply
//               </button>
//               <button
//                 onClick={() => setEditingColumns(false)}
//                 style={{
//                   background: "none",
//                   border: `1px solid ${t.hairline}`,
//                   borderRadius: "6px",
//                   padding: "10px 18px",
//                   fontSize: "13px",
//                   cursor: "pointer",
//                   color: t.inkMuted,
//                 }}
//               >
//                 Cancel
//               </button>
//             </div>
//           )}

//           <div style={{ flexShrink: 0, display: "flex", gap: "8px", flexWrap: "wrap" }}>
//             <button
//               onClick={copyTable}
//               disabled={rows.length === 0}
//               style={{
//                 background: copyState === "copied" ? t.accentBg : t.panel,
//                 border: `1px solid ${copyState === "copied" ? t.accent : t.hairlineStrong}`,
//                 color: copyState === "copied" ? t.accent : t.ink,
//                 borderRadius: "6px",
//                 padding: "9px 16px",
//                 fontSize: "12.5px",
//                 fontWeight: 600,
//                 cursor: rows.length === 0 ? "default" : "pointer",
//                 opacity: rows.length === 0 ? 0.4 : 1,
//                 whiteSpace: "nowrap",
//               }}
//             >
//               {copyState === "copied" ? "Copied ✓" : "Copy as markdown"}
//             </button>
//             <button
//               onClick={exportCSV}
//               disabled={rows.length === 0}
//               style={{
//                 background: t.panel,
//                 border: `1px solid ${t.hairlineStrong}`,
//                 color: t.ink,
//                 borderRadius: "6px",
//                 padding: "9px 16px",
//                 fontSize: "12.5px",
//                 fontWeight: 600,
//                 cursor: rows.length === 0 ? "default" : "pointer",
//                 opacity: rows.length === 0 ? 0.4 : 1,
//                 whiteSpace: "nowrap",
//               }}
//             >
//               CSV
//             </button>
//             <button
//               onClick={exportExcel}
//               disabled={rows.length === 0}
//               style={{
//                 background: t.panel,
//                 border: `1px solid ${t.hairlineStrong}`,
//                 color: t.ink,
//                 borderRadius: "6px",
//                 padding: "9px 16px",
//                 fontSize: "12.5px",
//                 fontWeight: 600,
//                 cursor: rows.length === 0 ? "default" : "pointer",
//                 opacity: rows.length === 0 ? 0.4 : 1,
//                 whiteSpace: "nowrap",
//               }}
//             >
//               Excel
//             </button>
//             <button
//               onClick={exportPDF}
//               disabled={rows.length === 0}
//               style={{
//                 background: t.panel,
//                 border: `1px solid ${t.hairlineStrong}`,
//                 color: t.ink,
//                 borderRadius: "6px",
//                 padding: "9px 16px",
//                 fontSize: "12.5px",
//                 fontWeight: 600,
//                 cursor: rows.length === 0 ? "default" : "pointer",
//                 opacity: rows.length === 0 ? 0.4 : 1,
//                 whiteSpace: "nowrap",
//               }}
//             >
//               PDF
//             </button>
//           </div>
//         </div>

//         {/* Drop zone */}
//         <div
//           className="dropzone"
//           onDragOver={(e) => {
//             e.preventDefault();
//             setIsDragging(true);
//           }}
//           onDragLeave={() => setIsDragging(false)}
//           onDrop={onDrop}
//           onClick={() => fileInputRef.current?.click()}
//           style={{
//             border: `1.5px dashed ${isDragging ? t.accent : t.hairlineStrong}`,
//             borderRadius: "10px",
//             background: isDragging ? t.accentBg : t.panel,
//             padding: "30px",
//             textAlign: "center",
//             cursor: "pointer",
//             marginBottom: "22px",
//           }}
//         >
//           <input
//             ref={fileInputRef}
//             type="file"
//             accept=".pdf"
//             multiple
//             style={{ display: "none" }}
//             onChange={(e) => {
//               handleFiles(e.target.files);
//               e.target.value = "";
//             }}
//           />
//           <div style={{ fontSize: "14.5px", fontWeight: 600, marginBottom: "4px", color: t.ink }}>
//             Drop transcript PDFs here, or click to browse — multiple at once is fine
//           </div>
//           <div className="mono" style={{ fontSize: "11.5px", color: t.inkFaint }}>
//             up to {MAX_CONCURRENT} processed at a time · a failed PDF won't block the rest
//           </div>
//         </div>

//         {/* Queue */}
//         {files.length > 0 && (
//           <div
//             className="scrollbox"
//             style={{ display: "flex", gap: "8px", marginBottom: "26px", overflowX: "auto", paddingBottom: "4px" }}
//           >
//             {files.map((f) => {
//               const isError = f.status === STATUS.ERROR;
//               const isDone = f.status === STATUS.DONE;
//               const isExtracting = f.status === STATUS.EXTRACTING;
//               const isQueued = f.status === STATUS.QUEUED;
//               return (
//                 <div
//                   key={f.id}
//                   className="mono"
//                   style={{
//                     flexShrink: 0,
//                     fontSize: "11px",
//                     border: `1px solid ${isError ? t.rust : isDone ? t.accent : t.hairline}`,
//                     borderRadius: "6px",
//                     padding: "7px 10px",
//                     background: t.panel,
//                     display: "flex",
//                     alignItems: "center",
//                     gap: "7px",
//                     maxWidth: "260px",
//                     color: t.ink,
//                     opacity: isQueued ? 0.6 : 1,
//                   }}
//                   title={f.error || f.name}
//                 >
//                   {isExtracting && (
//                     <svg className="spinner" width="11" height="11" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
//                       <circle
//                         cx="12" cy="12" r="9" fill="none"
//                         stroke={t.inkFaint} strokeWidth="3"
//                         strokeDasharray="14 30" strokeLinecap="round"
//                       />
//                     </svg>
//                   )}
//                   {isQueued && <span style={{ color: t.inkFaint, flexShrink: 0 }}>⋯</span>}
//                   {isDone && <span style={{ color: t.accent, flexShrink: 0 }}>✓</span>}
//                   {isError && <span style={{ color: t.rust, flexShrink: 0 }}>✕</span>}
//                   <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
//                     {f.name}
//                   </span>
//                   {isError && (
//                     <button
//                       onClick={() => retryFile(f)}
//                       style={{ background: "none", border: "none", color: t.rust, cursor: "pointer", fontSize: "10.5px", fontWeight: 700, padding: 0 }}
//                     >
//                       retry
//                     </button>
//                   )}
//                   <button
//                     onClick={() => removeFile(f.id)}
//                     className="icon-btn"
//                     style={{ background: "none", border: "none", color: t.inkFaint, opacity: 0.6, cursor: "pointer", fontSize: "13px", padding: "0 1px", lineHeight: 1 }}
//                     aria-label={`Remove ${f.name}`}
//                   >
//                     ×
//                   </button>
//                 </div>
//               );
//             })}
//           </div>
//         )}

//         {/* Table */}
//         {rows.length > 0 ? (
//           <div
//             className="scrollbox"
//             style={{
//               overflowX: "auto",
//               border: `1px solid ${t.hairline}`,
//               borderRadius: "10px",
//               background: t.panel,
//             }}
//           >
//             <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
//               <thead>
//                 <tr style={{ background: t.headerBg }}>
//                   {columns.map((c) => (
//                     <th
//                       key={c}
//                       className="mono"
//                       style={{
//                         color: t.headerInk,
//                         textAlign: "left",
//                         padding: "11px 16px",
//                         fontWeight: 600,
//                         fontSize: "10.5px",
//                         letterSpacing: "0.06em",
//                         whiteSpace: "nowrap",
//                         opacity: 0.85,
//                       }}
//                     >
//                       {c.toUpperCase()}
//                     </th>
//                   ))}
//                   <th style={{ width: "30px" }}></th>
//                 </tr>
//               </thead>
//               <tbody>
//                 {rows.map((r, idx) => {
//                   const isFresh = Date.now() - r.mintedAt < 900;
//                   const isExpanded = expandedRows.has(r.id);
//                   const citableColumns = columns.filter((c) => !NON_CITABLE_FIELDS.includes(c));
//                   const hasAnySource = citableColumns.some((c) => getCellSource(r.data[c]));
//                   return (
//                     <React.Fragment key={r.id}>
//                       <tr
//                         className={isFresh ? "print-in" : ""}
//                         style={{
//                           background: idx % 2 === 0 ? t.panel : t.bgSubtle,
//                           borderBottom: isExpanded ? "none" : `1px solid ${t.hairline}`,
//                         }}
//                       >
//                         {columns.map((c) => {
//                           const isTakeaway = c.toLowerCase().includes("takeaway");
//                           const isRisk = c.toLowerCase().includes("risk");
//                           const cellValue = getCellValue(r.data[c]);
//                           return (
//                             <td
//                               key={c}
//                               style={{
//                                 padding: "11px 16px",
//                                 verticalAlign: "top",
//                                 maxWidth: "260px",
//                                 fontWeight: c === "Company Name" ? 600 : 400,
//                                 color:
//                                   isRisk && cellValue && cellValue !== "No explicit guidance"
//                                     ? t.rust
//                                     : t.ink,
//                               }}
//                             >
//                               {cellValue ? (
//                                 <span
//                                   className={isTakeaway ? "takeaway-mark" : ""}
//                                   style={isTakeaway ? { "--mark-color": t.accentBg } : undefined}
//                                 >
//                                   {cellValue}
//                                 </span>
//                               ) : (
//                                 <span style={{ color: t.inkFaint }} className="mono">
//                                   —
//                                 </span>
//                               )}
//                             </td>
//                           );
//                         })}
//                         <td style={{ padding: "11px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
//                           {hasAnySource && (
//                             <button
//                               onClick={() => toggleRowExpanded(r.id)}
//                               className="icon-btn"
//                               style={{
//                                 background: "none",
//                                 border: "none",
//                                 color: isExpanded ? t.accent : t.inkFaint,
//                                 opacity: isExpanded ? 1 : 0.6,
//                                 cursor: "pointer",
//                                 fontSize: "11px",
//                                 padding: "0 6px",
//                               }}
//                               aria-label={isExpanded ? "Hide sources" : "Show sources"}
//                               title={isExpanded ? "Hide sources" : "Show sources"}
//                             >
//                               {isExpanded ? "▾ source" : "▸ source"}
//                             </button>
//                           )}
//                           <button
//                             onClick={() => removeRow(r.id)}
//                             className="icon-btn"
//                             style={{
//                               background: "none",
//                               border: "none",
//                               color: t.inkFaint,
//                               opacity: 0.5,
//                               cursor: "pointer",
//                               fontSize: "14px",
//                             }}
//                             aria-label={`Remove row for ${getCellValue(r.data["Company Name"]) || r.fileName}`}
//                           >
//                             ×
//                           </button>
//                         </td>
//                       </tr>
//                       {isExpanded && (
//                         <tr style={{ borderBottom: `1px solid ${t.hairline}` }}>
//                           <td
//                             colSpan={columns.length + 1}
//                             style={{
//                               padding: "4px 16px 14px",
//                               background: idx % 2 === 0 ? t.panel : t.bgSubtle,
//                             }}
//                           >
//                             <div
//                               style={{
//                                 borderLeft: `2px solid ${t.hairlineStrong}`,
//                                 paddingLeft: "14px",
//                                 display: "flex",
//                                 flexDirection: "column",
//                                 gap: "6px",
//                               }}
//                             >
//                               {citableColumns.map((c) => {
//                                 const quote = getCellSource(r.data[c]);
//                                 if (!quote) return null;
//                                 const page = getCellPage(r.data[c]);
//                                 return (
//                                   <div key={c} style={{ fontSize: "11.5px" }}>
//                                     <span
//                                       className="mono"
//                                       style={{
//                                         color: t.inkFaint,
//                                         letterSpacing: "0.04em",
//                                         marginRight: "8px",
//                                       }}
//                                     >
//                                       {c.toUpperCase()}
//                                     </span>
//                                     {page > 0 && (
//                                       <span
//                                         className="mono"
//                                         style={{
//                                           color: t.inkFaint,
//                                           fontSize: "10.5px",
//                                           marginRight: "8px",
//                                           border: `1px solid ${t.hairline}`,
//                                           borderRadius: "4px",
//                                           padding: "1px 6px",
//                                         }}
//                                       >
//                                         page {page}
//                                       </span>
//                                     )}
//                                     <span style={{ color: t.inkMuted, fontStyle: "italic" }}>
//                                       "{quote}"
//                                     </span>
//                                   </div>
//                                 );
//                               })}
//                             </div>
//                           </td>
//                         </tr>
//                       )}
//                     </React.Fragment>
//                   );
//                 })}
//               </tbody>
//             </table>
//           </div>
//         ) : (
//           files.length === 0 && (
//             <div
//               style={{
//                 textAlign: "center",
//                 padding: "48px 0",
//                 border: `1px dashed ${t.hairline}`,
//                 borderRadius: "10px",
//                 color: t.inkFaint,
//               }}
//             >
//               <div className="display" style={{ fontSize: "17px", color: t.inkMuted, marginBottom: "4px" }}>
//                 The ledger is empty
//               </div>
//               <div className="mono" style={{ fontSize: "11.5px" }}>
//                 drop a transcript above to start the first entry
//               </div>
//             </div>
//           )
//         )}
//       </div>
//     </div>
//   );
// }

import React, { useState, useCallback, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "./supabase";
import SignInPage from "./SignInPage";

// Backend base URL. Defaults to local dev; override at build time with
// VITE_API_BASE_URL (Vite) or REACT_APP_API_BASE_URL (CRA) once deployed.
const API_BASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE_URL) ||
  (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE_URL) ||
  "http://localhost:8000";

const DEFAULT_COLUMNS = [
  "Company Name",
  "Quarter and Year",
  "Growth Guidance",
  "Margin Guidance",
  "Capex/Expansion",
  "Order Book",
  "Key Risk",
  "Key Takeaway",
];

const MAX_CONCURRENT = 3;

const THEMES = {
  light: {
    bg: "#FAFAF8",
    bgSubtle: "#F2F1EC",
    panel: "#FFFFFF",
    ink: "#13151A",
    inkMuted: "#3A4A3D",
    inkFaint: "#6B6E66",
    accent: "#1F4D3D",
    accentBg: "#E8F0EA",
    rust: "#9B5B3E",
    rustBg: "#F5E9E2",
    hairline: "#E2E0D8",
    hairlineStrong: "#C9C6B8",
    headerBg: "#13151A",
    headerInk: "#FAFAF8",
  },
  dark: {
    bg: "#0D0F12",
    bgSubtle: "#15171B",
    panel: "#16181D",
    ink: "#E8E6E0",
    inkMuted: "#8B948C",
    inkFaint: "#5C6259",
    accent: "#3FAE85",
    accentBg: "#16261F",
    rust: "#D38A6C",
    rustBg: "#2A1D17",
    hairline: "#23262C",
    hairlineStrong: "#33363D",
    headerBg: "#0A0B0D",
    headerInk: "#E8E6E0",
  },
};

async function authHeaders(session) {
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

async function extractViaBackend(file, columns, session, forceRefresh = false) {
  const formData = new FormData();
  formData.append("file", file);

  const params = new URLSearchParams({ columns: columns.join(","), force_refresh: forceRefresh });

  const response = await fetch(`${API_BASE_URL}/extract?${params.toString()}`, {
    method: "POST",
    body: formData,
    headers: await authHeaders(session),
  });

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const errBody = await response.json();
      if (errBody?.detail) detail = errBody.detail;
    } catch (_) {}
    const err = new Error(detail);
    if (response.status === 402) err.limitReached = true;
    throw err;
  }

  const data = await response.json();
  return data.row || {};
}

function previousAdjacentQuarter(quarterYear) {
  const m = quarterYear && quarterYear.match(/^Q([1-4])-(\d{4})$/);
  if (!m) return null;
  const n = parseInt(m[1]), year = parseInt(m[2]);
  return n === 1 ? `Q4-${year - 1}` : `Q${n - 1}-${year}`;
}

const CONSISTENCY_DISPLAY = {
  REAFFIRMED: { label: "↔ Unchanged",  color: "#1F7A4D" },
  CHANGED:    { label: "↑↓ Revised",   color: "#B45309" },
  DROPPED:    { label: "✗ Withdrawn",  color: "#9B3E3E" },
  RESUMED:    { label: "↩ Reinstated", color: "#2563EB" },
};

const CONFIDENCE_DISPLAY = {
  HIGH:   { label: "HIGH",  color: "#1F7A4D" },
  MEDIUM: { label: "MED",   color: "#B45309" },
  LOW:    { label: "LOW",   color: "#9B3E3E" },
  "N/A":  { label: "N/A",  color: "#9B9D94" },
};

async function fetchConsistencyForRow(rowData, columns, session) {
  const companyField = rowData["Company Name"];
  const companyName = typeof companyField === "object" ? companyField.value : companyField;
  const quarterYear = rowData["Quarter and Year"] || "";
  if (!companyName || !quarterYear) return {};

  const headers = await authHeaders(session);
  const citable = columns.filter((c) => c !== "Quarter and Year" && rowData[c]?.value);
  const results = await Promise.allSettled(
    citable.map(async (fieldName) => {
      const value = rowData[fieldName]?.value || "";
      const params = new URLSearchParams({ company_name: companyName, field_name: fieldName, current_value: value, current_quarter_year: quarterYear });
      const res = await fetch(`${API_BASE_URL}/consistency?${params.toString()}`, { headers, signal: AbortSignal.timeout(30000) });
      if (!res.ok) return [fieldName, null];
      const data = await res.json();
      return [fieldName, data];
    })
  );

  const out = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value[1]) {
      const [field, data] = r.value;
      out[field] = data;
    }
  }
  return out;
}

const STATUS = {
  QUEUED: "queued",
  EXTRACTING: "extracting",
  DONE: "done",
  ERROR: "error",
};

function getCellValue(cellData) {
  if (cellData == null) return "";
  if (typeof cellData === "string") return cellData;
  return cellData.value || "";
}

function getCellSource(cellData) {
  if (cellData == null || typeof cellData === "string") return "";
  return cellData.source_quote || "";
}

function getCellPage(cellData) {
  if (cellData == null || typeof cellData === "string") return 0;
  return cellData.source_page || 0;
}

function getCellConfidence(cellData) {
  if (cellData == null || typeof cellData === "string") return null;
  return cellData.confidence || null;
}

function getMgmtConfidence(cellData) {
  if (cellData == null || typeof cellData === "string") return null;
  const score = cellData.mgmt_confidence;
  if (score == null || score === 0) return null;
  return { score, reason: cellData.mgmt_confidence_reason || "" };
}

function mgmtConfidenceColor(score) {
  if (score >= 8) return "#1F7A4D";
  if (score >= 5) return "#B45309";
  return "#9B3E3E";
}

// --- HELPER COMPONENT FOR INTERACTIVE MASK HIGHLIGHTING ---
function TourDomHighlighter({ targetId }) {
  useEffect(() => {
    if (!targetId) return;
    const currentFrameNode = document.getElementById(targetId);
    if (currentFrameNode) {
      currentFrameNode.classList.add("interactive-focus-highlight");
      currentFrameNode.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return () => {
      if (currentFrameNode) {
        currentFrameNode.classList.remove("interactive-focus-highlight");
      }
    };
  }, [targetId]);
  return null;
}

export default function ConcallTool() {
  const [theme, setTheme] = useState("light");
  const t = THEMES[theme];

  // --- AUTH STATE ---
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setRows([]);
    setFiles([]);
    setPastReports([]);
  };

  // --- PAST REPORTS SIDEBAR ---
  const [pastReports, setPastReports] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 900);

  // --- PRICING MODAL ---
  const [pricingOpen, setPricingOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(null); // tier name being loaded

  const handleUpgrade = async (tier) => {
    if (!session) {
      supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
      return;
    }
    setCheckoutLoading(tier);
    try {
      const res = await fetch(`${API_BASE_URL}/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to create order");

      const options = {
        key: data.key_id,
        amount: data.amount,
        currency: data.currency,
        name: "Concalls.in",
        description: `${tier.charAt(0).toUpperCase() + tier.slice(1)} Plan`,
        order_id: data.order_id,
        prefill: { email: session.user?.email || "" },
        theme: { color: "#1F4D3D" },
        handler: () => {
          setPricingOpen(false);
          alert("Payment successful! Your plan will be upgraded in a few seconds.");
        },
      };
      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      alert(err.message);
    } finally {
      setCheckoutLoading(null);
    }
  };

  const PLANS = [
    {
      name: "Free",
      price: { in: "₹0", intl: "$0" },
      reports: "10 reports / month",
      features: ["All 8 fields extracted", "Growth, Margin, Capex, Order Book", "Key Risk & Key Takeaway", "CSV / Excel / PDF export"],
      cta: "Current plan",
      ctaDisabled: true,
      highlight: false,
    },
    {
      name: "Growth",
      price: { in: "₹199/mo", intl: "$2/mo" },
      reports: "50 reports / month",
      features: ["Everything in Free", "Consistency tracking across quarters", "Confidence scores per field", "Full extraction history"],
      cta: "Upgrade to Growth",
      ctaDisabled: false,
      highlight: false,
    },
    {
      name: "Pro",
      price: { in: "₹499/mo", intl: "$5/mo" },
      reports: "150 reports / month",
      features: ["Everything in Growth", "Management confidence score (1–10)", "Implied guidance classification", "Exclusion notes & reasoning"],
      cta: "Upgrade to Pro",
      ctaDisabled: false,
      highlight: true,
    },
    {
      name: "Elite",
      price: { in: "₹999/mo", intl: "$9/mo" },
      reports: "Unlimited reports",
      features: ["Everything in Pro", "Priority support", "Early access to new features", "Direct access to founder"],
      cta: "Upgrade to Elite",
      ctaDisabled: false,
      highlight: false,
    },
  ];

  // --- GLOSSARY ---
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => localStorage.getItem("concalls_onboarding_dismissed") === "true"
  );
  const dismissOnboarding = () => {
    localStorage.setItem("concalls_onboarding_dismissed", "true");
    setOnboardingDismissed(true);
  };

  const GLOSSARY = [
    { term: "Company Name", def: "The company whose earnings call transcript was uploaded. Extracted automatically from the PDF." },
    { term: "Quarter and Year", def: "The financial quarter and fiscal year the call covers — e.g. Q4-2025 means the fourth quarter of fiscal year 2025." },
    { term: "Growth Guidance", def: "Revenue or volume targets set by management for the next quarter or year. Often given as a percentage range or absolute figure." },
    { term: "Margin Guidance", def: "Management's expected profitability margins — gross, EBITDA, or PAT — for the upcoming period." },
    { term: "Capex / Expansion", def: "Capital expenditure plans: how much the company intends to spend on new facilities, equipment, or expansion into new markets." },
    { term: "Order Book", def: "The total value of confirmed orders not yet fulfilled. A high order book signals future revenue visibility." },
    { term: "Key Risk", def: "Risks management explicitly acknowledged — macro headwinds, input costs, regulatory changes, or competitive threats." },
    { term: "Key Takeaway", def: "The single most important signal from the call — what management is really communicating about the business direction." },
  ];

  useEffect(() => {
    if (!session) { setPastReports([]); return; }
    fetch(`${API_BASE_URL}/reports`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => { console.log("GET /reports status:", r.status); return r.json(); })
      .then(data => { console.log("GET /reports data:", data); console.log("reports length:", data.reports?.length); console.log("sidebarOpen:", sidebarOpen); setPastReports(data.reports || []); })
      .catch(err => console.error("GET /reports error:", err));
  }, [session]);

  const loadPastReport = async (company_name, quarter_year) => {
    if (!session) return;
    const params = new URLSearchParams({ company_name, quarter_year, columns: columns.join(",") });
    const res = await fetch(`${API_BASE_URL}/report?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (!res.ok) return;
    const data = await res.json();
    const rowId = ++idCounter.current;
    const consistency = await fetchConsistencyForRow(data.row, columns, session).catch(() => ({}));
    setRows(prev => [...prev, { id: rowId, fileName: `${company_name} ${quarter_year}`, file: null, data: data.row, consistency, mintedAt: Date.now() }]);
  };

  // Group past reports by company
  const reportsByCompany = pastReports.reduce((acc, r) => {
    if (!acc[r.company_name]) acc[r.company_name] = [];
    acc[r.company_name].push(r);
    return acc;
  }, {});

  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [files, setFiles] = useState([]);
  const [rows, setRows] = useState([]);
  const [expandedRows, setExpandedRows] = useState(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const [copyState, setCopyState] = useState("idle"); // idle | copied
  const fileInputRef = useRef(null);
  const idCounter = useRef(0);

  // --- INTERACTIVE VIDEO TUTORIAL STATE ---
  const [showVideoModal, setShowVideoModal] = useState(true); 
  const [videoTime, setVideoTime] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  const VIDEO_DURATION = 15; 
  const TOUR_TIMELINE = [
    { time: 0, target: "tour-dropzone", title: "1. Drop Transcripts", desc: "Drag and drop raw conference call PDFs directly into your local browser pipeline." },
    { time: 5, target: "tour-fields", title: "2. Define Parameters", desc: "Customize targeted corporate fields or KPI indicators on the fly before running structural extractions." },
    { time: 10, target: "tour-copy", title: "3. Structured Matrix Export", desc: "Instantly capture neatly organized Markdown layouts, clean CSV files, or Excel sheets directly to your research stack." }
  ];

  const currentTimelineStep = TOUR_TIMELINE.reduce((prev, curr) => 
    videoTime >= curr.time ? curr : prev
  , TOUR_TIMELINE[0]);

  // Run simulated overview player clock
  useEffect(() => {
    let interval;
    if (isVideoPlaying) {
      interval = setInterval(() => {
        setVideoTime((prev) => {
          if (prev >= VIDEO_DURATION) {
            setIsVideoPlaying(false);
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isVideoPlaying]);

  // Seed mockup preview data row to let users feel the layout engine alive
  useEffect(() => {
    if (videoTime >= 5 && rows.length === 0) {
      setRows([
        {
          id: 999,
          fileName: "Sample_Transcript_Q4.pdf",
          mintedAt: Date.now(),
          data: {
            "Company Name": "Alpha Industries Ltd",
            "Quarter and Year": "Q4 FY26",
            "Growth Guidance": "14-16% top-line momentum driven by expansion strategies.",
            "Margin Guidance": "Operating metrics steady near 21.5% due to asset efficiency.",
            "Capex/Expansion": "Greenfield setup active in North corridor.",
            "Order Book": "Sustained execution book holding over ₹4,200 Cr.",
            "Key Risk": "Input logistics variables subject to near-term constraints.",
            "Key Takeaway": "Core margin defense frameworks structurally strong.",
          }
        }
      ]);
    }
  }, [videoTime, rows.length]);

  const queueRef = useRef([]);
  const activeWorkersRef = useRef(0);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const addFiles = useCallback((fileList) => {
    const pdfFiles = Array.from(fileList).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf")
    );
    const entries = pdfFiles.map((f) => ({
      id: ++idCounter.current,
      file: f,
      name: f.name,
      status: STATUS.QUEUED,
      error: null,
    }));
    setFiles((prev) => [...prev, ...entries]);
    return entries;
  }, []);

  const processOne = useCallback(async (entry) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === entry.id ? { ...f, status: STATUS.EXTRACTING } : f))
    );
    try {
      const rowData = await extractViaBackend(entry.file, columnsRef.current, sessionRef.current);
      const consistency = sessionRef.current
        ? await fetchConsistencyForRow(rowData, columnsRef.current, sessionRef.current).catch(() => ({}))
        : {};
      const rowId = ++idCounter.current;
      setRows((prev) => [
        ...prev,
        { id: rowId, fileName: entry.name, file: entry.file, data: rowData, consistency, mintedAt: Date.now() },
      ]);

      // Refresh sidebar past reports
      if (sessionRef.current) {
        fetch(`${API_BASE_URL}/reports`, { headers: { Authorization: `Bearer ${sessionRef.current.access_token}` } })
          .then(r => r.json())
          .then(data => setPastReports(data.reports || []))
          .catch(() => {});
      }

      // Re-fetch consistency for all existing rows — a newly uploaded quarter
      // may be the prior quarter that other rows were waiting for
      if (sessionRef.current) {
        setRows((prev) =>
          prev.map((r) => {
            if (r.id === rowId) return r;
            fetchConsistencyForRow(r.data, columnsRef.current, sessionRef.current)
              .then((newConsistency) => {
                setRows((latest) =>
                  latest.map((lr) => lr.id === r.id ? { ...lr, consistency: newConsistency } : lr)
                );
              })
              .catch(() => {});
            return r;
          })
        );
      }
      setFiles((prev) =>
        prev.map((f) => (f.id === entry.id ? { ...f, status: STATUS.DONE } : f))
      );
    } catch (err) {
      if (err.limitReached) {
        setFiles((prev) => prev.map((f) => f.id === entry.id ? { ...f, status: STATUS.ERROR, error: "Monthly report limit reached." } : f));
        setPricingOpen(true);
      } else {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === entry.id ? { ...f, status: STATUS.ERROR, error: err.message } : f
          )
        );
      }
    }
  }, []);

  const pump = useCallback(() => {
    while (activeWorkersRef.current < MAX_CONCURRENT && queueRef.current.length > 0) {
      const entry = queueRef.current.shift();
      activeWorkersRef.current += 1;
      processOne(entry).finally(() => {
        activeWorkersRef.current -= 1;
        pump();
      });
    }
  }, [processOne]);

  const processQueue = useCallback(
    (entries) => {
      queueRef.current.push(...entries);
      pump();
    },
    [pump]
  );

  const handleFiles = useCallback(
    (fileList) => {
      const entries = addFiles(fileList);
      if (entries.length > 0) processQueue(entries);
    },
    [addFiles, processQueue]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const exportMarkdown = () => {
    const header = `| ${columns.join(" | ")} |`;
    const sep = `| ${columns.map(() => "---").join(" | ")} |`;
    const body = rows
      .map(
        (r) =>
          `| ${columns
            .map((c) => getCellValue(r.data[c]).replace(/\|/g, "/"))
            .join(" | ")} |`
      )
      .join("\n");
    return [header, sep, body].join("\n");
  };

  const downloadBlob = (content, filename, mimeType) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const tableRowsAsStrings = () => rows.map((r) => columns.map((c) => getCellValue(r.data[c])));

  const exportCSV = () => {
    const escapeCell = (val) => `"${String(val).replace(/"/g, '""')}"`;
    const header = columns.map(escapeCell).join(",");
    const body = tableRowsAsStrings()
      .map((row) => row.map(escapeCell).join(","))
      .join("\n");
    downloadBlob("\ufeff" + [header, body].join("\n"), "concall-ledger.csv", "text/csv;charset=utf-8;");
  };

  const exportExcel = () => {
    const wsData = [columns, ...tableRowsAsStrings()];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = columns.map(() => ({ wch: 28 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Ledger");
    XLSX.writeFile(wb, "concall-ledger.xlsx");
  };

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(14);
    doc.text("Concalls.in — Management Guidance Tracker", 32, 28);
    autoTable(doc, {
      startY: 42,
      head: [columns],
      body: tableRowsAsStrings(),
      styles: { fontSize: 7, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [19, 21, 26] },
      columnStyles: Object.fromEntries(columns.map((_, i) => [i, { cellWidth: "auto" }])),
      margin: { left: 24, right: 24 },
    });
    doc.save("concall-ledger.pdf");
  };

  const toggleRowExpanded = (rowId) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const copyTable = async () => {
    try {
      await navigator.clipboard.writeText(exportMarkdown());
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1800);
    } catch (_) {}
  };

  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));
  const removeFile = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));
  const retryFile = (entry) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === entry.id ? { ...f, status: STATUS.QUEUED, error: null } : f))
    );
    processQueue([entry]);
  };

  const activeCount = files.filter(
    (f) => f.status === STATUS.EXTRACTING || f.status === STATUS.QUEUED
  ).length;

  const NON_CITABLE_FIELDS = ["Quarter and Year", "Company Name"];

  // Still initialising — show nothing to avoid flash
  if (session === undefined) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: t.bg,
        color: t.ink,
        fontFamily: "'Inter', -apple-system, sans-serif",
        transition: "background 0.25s ease, color 0.25s ease",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { width: 100%; min-height: 100vh; }
        .display { font-family: 'Fraunces', serif; font-optical-sizing: auto; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        button { font-family: inherit; }
        button:focus-visible, input:focus-visible, textarea:focus-visible {
          outline: 2px solid ${t.accent};
          outline-offset: 2px;
        }
        .dropzone { transition: border-color 0.18s ease, background 0.18s ease; }

        @keyframes printIn {
          from { clip-path: inset(0 100% 0 0); opacity: 0.4; }
          to   { clip-path: inset(0 0% 0 0); opacity: 1; }
        }
        .print-in { animation: printIn 0.55s cubic-bezier(0.16, 1, 0.3, 1); }

        @keyframes markHighlight {
          0%   { background-size: 0% 100%; }
          100% { background-size: 100% 100%; }
        }
        .takeaway-mark {
          background-image: linear-gradient(180deg, transparent 62%, var(--mark-color) 62%);
          background-repeat: no-repeat;
          background-size: 0% 100%;
          animation: markHighlight 0.5s ease-out 0.5s forwards;
        }

        @keyframes softPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        .pulse { animation: softPulse 1.3s ease-in-out infinite; }

        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner { animation: spin 0.8s linear infinite; }

        @media (prefers-reduced-motion: reduce) {
          .print-in, .takeaway-mark, .pulse, .spinner { animation: none !important; background-size: 100% 100% !important; }
        }

        .scrollbox::-webkit-scrollbar { height: 8px; width: 8px; }
        .scrollbox::-webkit-scrollbar-thumb { background: ${t.hairlineStrong}; border-radius: 4px; }

        .icon-btn { transition: opacity 0.15s ease, background 0.15s ease; }
        .icon-btn:hover { opacity: 1 !important; }

        @media (max-width: 720px) {
          .sidebar { display: none !important; }
          .header-row { flex-direction: column; align-items: flex-start !important; gap: 10px; padding: 14px 16px !important; }
          .header-right { flex-wrap: wrap; gap: 8px !important; }
          .toolbar-row { flex-direction: column; align-items: stretch !important; }
          .toolbar-row > div:last-child { align-self: flex-end; }
          .main-content { padding: 20px 16px 48px !important; }
          .display-heading { font-size: 18px !important; }
          .export-btns { flex-wrap: wrap !important; }
          table { font-size: 11px !important; }
          td, th { padding: 8px 10px !important; max-width: 140px !important; }
          .dropzone-area { padding: 20px 14px !important; }
        }

        /* LIVE OVERVIEW OVERLAY FOCUS TRACKERS */
        .interactive-focus-highlight {
          position: relative !important;
          z-index: 10001 !important;
          pointer-events: none !important;
          box-shadow: 0 0 0 6px ${t.accentBg}, 0 20px 25px -5px rgba(0,0,0,0.15) !important;
          transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .timeline-progress-bar {
          height: 100%;
          background: ${t.accent};
          transition: width 1s linear;
        }
      `}</style>

      {/* --- INJECT FOCUS PORTAL ELEMENT WRAPPER --- */}
      <TourDomHighlighter targetId={showVideoModal ? currentTimelineStep.target : null} />

      {/* --- PLAYBACK PANEL CONTAINER CONTROL DECK --- */}
      {showVideoModal && (
        <>
          <div 
            onClick={() => { setShowVideoModal(false); setIsVideoPlaying(false); }}
            style={{
              position: "fixed", inset: 0, background: "rgba(13, 15, 18, 0.3)",
              backdropFilter: "blur(2px)", zIndex: 10000, transition: "opacity 0.25s ease"
            }} 
          />
          <div style={{
            position: "fixed", bottom: "32px", left: "50%", transform: "translateX(-50%)",
            width: "min(460px, 92vw)", background: t.panel, border: `1px solid ${t.hairlineStrong}`,
            borderRadius: "12px", boxShadow: "0 24px 38px -4px rgba(0,0,0,0.15)",
            zIndex: 10005, padding: "20px", display: "flex", flexDirection: "column", gap: "12px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h4 className="display" style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: t.ink }}>
                {currentTimelineStep.title}
              </h4>
              <span className="mono" style={{ fontSize: "10px", color: t.inkFaint }}>
                0:{(videoTime < 10 ? "0" : "") + videoTime} / 0:{VIDEO_DURATION}
              </span>
            </div>

            <p style={{ margin: 0, fontSize: "12.5px", lineHeight: "1.5", color: t.inkMuted }}>
              {currentTimelineStep.desc}
            </p>

            <div style={{ width: "100%", height: "4px", background: t.bgSubtle, borderRadius: "2px", overflow: "hidden" }}>
              <div className="timeline-progress-bar" style={{ width: `${(videoTime / VIDEO_DURATION) * 100}%` }} />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "4px" }}>
              <button 
                onClick={() => { setShowVideoModal(false); setIsVideoPlaying(false); setRows([]); }}
                className="mono" style={{ background: "none", border: "none", color: t.inkFaint, fontSize: "11px", cursor: "pointer", padding: 0 }}
              >
                Dismiss Tour
              </button>
              <button
                onClick={() => setIsVideoPlaying(!isVideoPlaying)}
                style={{
                  background: isVideoPlaying ? t.bgSubtle : t.accent,
                  color: isVideoPlaying ? t.ink : t.bg,
                  border: "none", borderRadius: "6px", padding: "6px 14px",
                  fontSize: "12px", fontWeight: 600, cursor: "pointer", display: "flex", gap: "6px", alignItems: "center"
                }}
              >
                {isVideoPlaying ? "Pause Walkthrough" : "Play Live Demo"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Top bar */}
      <div
        style={{
          background: t.headerBg,
          color: t.headerInk,
          borderBottom: `1px solid ${t.hairlineStrong}`,
        }}
      >
        <div
          className="header-row"
          style={{
            maxWidth: "1800px",
            margin: "0 auto",
            padding: "22px 48px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: "14px" }}>
            <span
              className="display"
              style={{ fontSize: "22px", fontWeight: 600, letterSpacing: "-0.01em" }}
            >
              Concalls.in
            </span>
            <span
              className="mono"
              style={{
                fontSize: "10.5px",
                letterSpacing: "0.14em",
                opacity: 0.55,
                textTransform: "uppercase",
              }}
            >
              Management Guidance Tracker
            </span>
          </div>

          <div className="header-right" style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <span className="mono" style={{ fontSize: "11.5px", opacity: 0.6 }}>
              {rows.length} extracted
              {activeCount > 0
                ? ` · ${activeCount} in queue (up to ${MAX_CONCURRENT} at once)`
                : ""}
            </span>

            {/* --- REPLAY WALKTHROUGH BUTTON --- */}
            <button
              onClick={() => { setVideoTime(0); setShowVideoModal(true); setIsVideoPlaying(true); }}
              className="mono"
              style={{
                background: "transparent",
                border: `1px solid ${theme === "light" ? "rgba(250,250,248,0.25)" : t.hairlineStrong}`,
                borderRadius: "20px",
                padding: "5px 12px",
                cursor: "pointer",
                color: t.headerInk,
                fontSize: "11px",
              }}
            >
              ▷ Run Tour
            </button>

            <button
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              style={{
                background: "transparent",
                border: `1px solid ${theme === "light" ? "rgba(250,250,248,0.25)" : t.hairlineStrong}`,
                borderRadius: "20px",
                padding: "5px 12px 5px 5px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                cursor: "pointer",
                color: t.headerInk,
              }}
            >
              <span
                style={{
                  width: "18px",
                  height: "18px",
                  borderRadius: "50%",
                  background: theme === "light" ? "#F2C14E" : "#3FAE85",
                  display: "inline-block",
                }}
              />
              <span className="mono" style={{ fontSize: "11px" }}>
                {theme === "light" ? "Light" : "Dark"}
              </span>
            </button>

            {/* Auth area */}
            {session ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginLeft: "4px" }}>
                <button
                  onClick={() => setPricingOpen(true)}
                  style={{
                    background: "#3FAE85", border: "none", borderRadius: "20px",
                    padding: "5px 14px", fontSize: "11.5px", fontWeight: 700,
                    color: "#fff", cursor: "pointer", letterSpacing: "0.02em",
                  }}
                >
                  Upgrade ↑
                </button>
                {session.user?.user_metadata?.avatar_url ? (
                  <img
                    src={session.user.user_metadata.avatar_url}
                    alt="avatar"
                    style={{ width: "28px", height: "28px", borderRadius: "50%", border: "1.5px solid rgba(255,255,255,0.2)" }}
                  />
                ) : (
                  <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", color: t.headerInk }}>
                    {(session.user?.email || session.user?.user_metadata?.name || "?")[0].toUpperCase()}
                  </div>
                )}
                <button
                  onClick={handleSignOut}
                  style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.55)", fontSize: "12px", cursor: "pointer", padding: "0" }}
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } })}
                style={{
                  background: "rgba(255,255,255,0.1)",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "20px",
                  padding: "5px 14px",
                  color: t.headerInk,
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                  marginLeft: "4px",
                  whiteSpace: "nowrap",
                }}
              >
                Save progress →
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", maxWidth: "1800px", margin: "0 auto", alignItems: "flex-start" }}>

        {/* --- SIDEBAR --- */}
        {session && (
          <div className="sidebar" style={{
            width: sidebarOpen ? "260px" : "48px",
            minWidth: sidebarOpen ? "260px" : "48px",
            borderRight: `1px solid ${t.hairlineStrong}`,
            background: t.bgSubtle,
            boxShadow: sidebarOpen ? "2px 0 12px rgba(0,0,0,0.06)" : "none",
            transition: "width 0.2s ease, min-width 0.2s ease",
            display: "flex",
            flexDirection: "column",
            height: "calc(100vh - 69px)",
            position: "sticky",
            top: "69px",
            overflow: "hidden",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 14px 14px", borderBottom: `1px solid ${t.hairlineStrong}` }}>
              {sidebarOpen && (
                <span className="mono" style={{ fontSize: "10.5px", letterSpacing: "0.12em", color: t.ink, fontWeight: 700 }}>
                  PAST REPORTS
                </span>
              )}
              <button
                onClick={() => setSidebarOpen(o => !o)}
                style={{ background: "none", border: `1px solid ${t.hairline}`, borderRadius: "6px", cursor: "pointer", color: t.inkMuted, fontSize: "13px", padding: "3px 7px", marginLeft: "auto" }}
                title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              >
                {sidebarOpen ? "◂" : "▸"}
              </button>
            </div>

            {sidebarOpen && (
              <div style={{ overflowY: "auto", flex: 1, padding: "12px 0" }}>
                {Object.keys(reportsByCompany).length === 0 ? (
                  <p style={{ fontSize: "12px", color: t.inkMuted, padding: "16px", lineHeight: 1.6 }}>
                    Your extracted reports will appear here.
                  </p>
                ) : (
                  Object.entries(reportsByCompany).map(([company, reports]) => (
                    <div key={company} style={{ marginBottom: "18px" }}>
                      <div style={{ fontSize: "11.5px", fontWeight: 700, color: t.ink, padding: "4px 16px 6px", letterSpacing: "0.01em" }}>
                        {company}
                      </div>
                      {reports.map(r => (
                        <button
                          key={r.quarter_year}
                          onClick={() => loadPastReport(r.company_name, r.quarter_year)}
                          style={{
                            display: "block", width: "100%", textAlign: "left",
                            padding: "7px 16px 7px 28px", background: "none", border: "none",
                            cursor: "pointer", fontSize: "12.5px", color: t.inkMuted,
                            fontFamily: "'JetBrains Mono', monospace",
                            borderLeft: `2px solid transparent`,
                            transition: "background 0.1s, border-color 0.1s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = t.panel; e.currentTarget.style.borderLeftColor = t.accent; e.currentTarget.style.color = t.ink; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "none"; e.currentTarget.style.borderLeftColor = "transparent"; e.currentTarget.style.color = t.inkMuted; }}
                        >
                          {r.quarter_year}
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        <div className="main-content" style={{ flex: 1, padding: "36px 48px 72px", minWidth: 0 }}>
        <p
          className="display display-heading"
          style={{
            fontSize: "26px",
            fontWeight: 500,
            lineHeight: 1.35,
            margin: "0 0 28px",
            maxWidth: "640px",
            color: t.ink,
          }}
        >
          The transcript is 50 pages. Management declares it in one line. We track it every quarter.
        </p>

        {/* Column config row */}
        <div
          id="tour-fields"
          className="toolbar-row"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "18px",
            paddingBottom: "18px",
            borderBottom: `1px solid ${t.hairline}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span
              className="mono"
              style={{ fontSize: "10.5px", color: t.inkFaint, letterSpacing: "0.1em", marginRight: "4px" }}
            >
              FIELDS
            </span>
            {columns.map((c) => (
              <span
                key={c}
                className="mono"
                style={{
                  fontSize: "11.5px",
                  color: t.inkMuted,
                  background: t.bgSubtle,
                  border: `1px solid ${t.hairline}`,
                  borderRadius: "4px",
                  padding: "4px 9px",
                }}
              >
                {c}
              </span>
            ))}
            <button
              onClick={() => setGlossaryOpen(true)}
              style={{
                background: "none", border: `1px solid ${t.hairline}`, borderRadius: "6px",
                color: t.inkMuted, cursor: "pointer", fontSize: "12px", padding: "4px 10px",
                fontFamily: "inherit",
              }}
              title="What do these fields mean?"
            >
              ? What do these mean
            </button>
          </div>

          <div id="tour-copy" className="export-btns" style={{ flexShrink: 0, display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              onClick={copyTable}
              disabled={rows.length === 0}
              style={{
                background: copyState === "copied" ? t.accentBg : t.panel,
                border: `1px solid ${copyState === "copied" ? t.accent : t.hairlineStrong}`,
                color: copyState === "copied" ? t.accent : t.ink,
                borderRadius: "6px",
                padding: "9px 16px",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: rows.length === 0 ? "default" : "pointer",
                opacity: rows.length === 0 ? 0.4 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {copyState === "copied" ? "Copied ✓" : "Copy as markdown"}
            </button>
            <button
              onClick={exportCSV}
              disabled={rows.length === 0}
              style={{
                background: t.panel,
                border: `1px solid ${t.hairlineStrong}`,
                color: t.ink,
                borderRadius: "6px",
                padding: "9px 16px",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: rows.length === 0 ? "default" : "pointer",
                opacity: rows.length === 0 ? 0.4 : 1,
                whiteSpace: "nowrap",
              }}
            >
              CSV
            </button>
            <button
              onClick={exportExcel}
              disabled={rows.length === 0}
              style={{
                background: t.panel,
                border: `1px solid ${t.hairlineStrong}`,
                color: t.ink,
                borderRadius: "6px",
                padding: "9px 16px",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: rows.length === 0 ? "default" : "pointer",
                opacity: rows.length === 0 ? 0.4 : 1,
                whiteSpace: "nowrap",
              }}
            >
              Excel
            </button>
            <button
              onClick={exportPDF}
              disabled={rows.length === 0}
              style={{
                background: t.panel,
                border: `1px solid ${t.hairlineStrong}`,
                color: t.ink,
                borderRadius: "6px",
                padding: "9px 16px",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: rows.length === 0 ? "default" : "pointer",
                opacity: rows.length === 0 ? 0.4 : 1,
                whiteSpace: "nowrap",
              }}
            >
              PDF
            </button>
          </div>
        </div>

        {/* Drop zone */}
        <div
          id="tour-dropzone"
          className="dropzone dropzone-area"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `1.5px dashed ${isDragging ? t.accent : t.hairlineStrong}`,
            borderRadius: "10px",
            background: isDragging ? t.accentBg : t.panel,
            padding: "30px",
            textAlign: "center",
            cursor: "pointer",
            marginBottom: "22px",
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div style={{ fontSize: "14.5px", fontWeight: 600, marginBottom: "4px", color: t.ink }}>
            Drop transcript PDFs here, or click to browse — multiple at once is fine
          </div>
          <div className="mono" style={{ fontSize: "11.5px", color: t.inkFaint }}>
            up to {MAX_CONCURRENT} processed at a time · a failed PDF won't block the rest
          </div>
        </div>

        {/* Queue */}
        {files.length > 0 && (
          <div
            className="scrollbox"
            style={{ display: "flex", gap: "8px", marginBottom: "26px", overflowX: "auto", paddingBottom: "4px" }}
          >
            {files.map((f) => {
              const isError = f.status === STATUS.ERROR;
              const isDone = f.status === STATUS.DONE;
              const isExtracting = f.status === STATUS.EXTRACTING;
              const isQueued = f.status === STATUS.QUEUED;
              return (
                <div
                  key={f.id}
                  className="mono"
                  style={{
                    flexShrink: 0,
                    fontSize: "11px",
                    border: `1px solid ${isError ? t.rust : isDone ? t.accent : t.hairline}`,
                    borderRadius: "6px",
                    padding: "7px 10px",
                    background: t.panel,
                    display: "flex",
                    alignItems: "center",
                    gap: "7px",
                    maxWidth: "260px",
                    color: t.ink,
                    opacity: isQueued ? 0.6 : 1,
                  }}
                  title={f.error || f.name}
                >
                  {isExtracting && (
                    <svg className="spinner" width="11" height="11" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                      <circle
                        cx="12" cy="12" r="9" fill="none"
                        stroke={t.inkFaint} strokeWidth="3"
                        strokeDasharray="14 30" strokeLinecap="round"
                      />
                    </svg>
                  )}
                  {isQueued && <span style={{ color: t.inkFaint, flexShrink: 0 }}>⋯</span>}
                  {isDone && <span style={{ color: t.accent, flexShrink: 0 }}>✓</span>}
                  {isError && <span style={{ color: t.rust, flexShrink: 0 }}>✕</span>}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.name}
                  </span>
                  {isError && (
                    <button
                      onClick={() => retryFile(f)}
                      style={{ background: "none", border: "none", color: t.rust, cursor: "pointer", fontSize: "10.5px", fontWeight: 700, padding: 0 }}
                    >
                      retry
                    </button>
                  )}
                  <button
                    onClick={() => removeFile(f.id)}
                    className="icon-btn"
                    style={{ background: "none", border: "none", color: t.inkFaint, opacity: 0.6, cursor: "pointer", fontSize: "13px", padding: "0 1px", lineHeight: 1 }}
                    aria-label={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Onboarding banner — shown to first-time users when a result appears */}
        {rows.length > 0 && !onboardingDismissed && (
          <div style={{
            display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px",
            background: t.accentBg, border: `1px solid ${t.accent}22`, borderRadius: "10px",
            padding: "14px 18px", marginBottom: "20px",
          }}>
            <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <span style={{ fontSize: "20px", lineHeight: 1 }}>📖</span>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: t.accent, marginBottom: "3px" }}>
                  First time here? Here's what each column means.
                </div>
                <div style={{ fontSize: "12px", color: t.inkMuted, lineHeight: 1.5 }}>
                  Each column tracks a specific type of management guidance — growth targets, margin expectations, risks, and more.{" "}
                  <button
                    onClick={() => setGlossaryOpen(true)}
                    style={{ background: "none", border: "none", color: t.accent, cursor: "pointer", fontSize: "12px", fontWeight: 600, padding: 0, textDecoration: "underline" }}
                  >
                    Open glossary →
                  </button>
                </div>
              </div>
            </div>
            <button
              onClick={dismissOnboarding}
              style={{ background: "none", border: "none", color: t.inkFaint, cursor: "pointer", fontSize: "16px", flexShrink: 0, padding: "0 4px" }}
              title="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* Table */}
        {rows.length > 0 ? (
          <div
            className="scrollbox"
            style={{
              overflowX: "auto",
              border: `1px solid ${t.hairline}`,
              borderRadius: "10px",
              background: t.panel,
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: t.headerBg }}>
                  {columns.map((c) => (
                    <th
                      key={c}
                      className="mono"
                      style={{
                        color: t.headerInk,
                        textAlign: "left",
                        padding: "11px 16px",
                        fontWeight: 600,
                        fontSize: "10.5px",
                        letterSpacing: "0.06em",
                        whiteSpace: "nowrap",
                        opacity: 0.85,
                      }}
                    >
                      {c.toUpperCase()}
                    </th>
                  ))}
                  <th style={{ width: "30px" }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const isFresh = Date.now() - r.mintedAt < 900;
                  const isExpanded = expandedRows.has(r.id);
                  const citableColumns = columns.filter((c) => !NON_CITABLE_FIELDS.includes(c));
                  const hasAnySource = citableColumns.some((c) => getCellSource(r.data[c]));
                  return (
                    <React.Fragment key={r.id}>
                      <tr
                        className={isFresh ? "print-in" : ""}
                        style={{
                          background: idx % 2 === 0 ? t.panel : t.bgSubtle,
                          borderBottom: isExpanded ? "none" : `1px solid ${t.hairline}`,
                        }}
                      >
                        {columns.map((c) => {
                          const isTakeaway = c.toLowerCase().includes("takeaway");
                          const isRisk = c.toLowerCase().includes("risk");
                          const cellValue = getCellValue(r.data[c]);
                          const isImplied = cellValue.startsWith("Implied:");
                          const isNoGuidance = cellValue === "No explicit guidance";
                          const exclusionNote = (!isImplied && typeof r.data[c] === "object") ? (r.data[c]?.exclusion_note || "") : "";
                          const rawConsistency = c !== "Company Name" ? r.consistency?.[c] : null;
                          const consistencyIsNew = rawConsistency?.status === "NEW";
                          const consistencyData = (rawConsistency && !consistencyIsNew) ? rawConsistency : null;
                          const consistencyDisplay = consistencyData ? CONSISTENCY_DISPLAY[consistencyData.status] : null;
                          const currentQuarter = getCellValue(r.data["Quarter and Year"]);
                          const prevQuarter = previousAdjacentQuarter(currentQuarter);
                          const mgmtConf = c !== "Company Name" && c !== "Quarter and Year" ? getMgmtConfidence(r.data[c]) : null;
                          return (
                            <td
                              key={c}
                              style={{
                                padding: "11px 16px",
                                verticalAlign: "top",
                                maxWidth: "260px",
                                fontWeight: c === "Company Name" ? 600 : 400,
                                color:
                                  isRisk && cellValue && !isNoGuidance
                                    ? t.rust
                                    : t.ink,
                              }}
                            >
                              {isNoGuidance ? (
                                <span
                                  title={exclusionNote || undefined}
                                  style={{
                                    color: t.inkMuted,
                                    fontSize: "13px",
                                    cursor: exclusionNote ? "help" : "default",
                                    borderBottom: exclusionNote ? `1px dashed ${t.inkMuted}` : "none",
                                  }}
                                >
                                  No explicit guidance
                                </span>
                              ) : cellValue ? (
                                <span
                                  className={isTakeaway ? "takeaway-mark" : ""}
                                  style={{
                                    ...(isTakeaway ? { "--mark-color": t.accentBg } : {}),
                                    ...(isImplied ? { color: t.inkMuted, fontStyle: "italic" } : {}),
                                  }}
                                >
                                  {cellValue}
                                </span>
                              ) : (
                                <span style={{ color: t.inkFaint }} className="mono">
                                  —
                                </span>
                              )}
                              {session && consistencyIsNew && prevQuarter && c !== "Company Name" && c !== "Quarter and Year" && cellValue && cellValue !== "No explicit guidance" && (
                                <div style={{ marginTop: "5px" }}>
                                  <span
                                    title={`Upload the ${prevQuarter} report to enable quarter-on-quarter comparison for this field`}
                                    style={{
                                      fontSize: "10px",
                                      color: t.inkFaint,
                                      borderBottom: `1px dashed ${t.inkFaint}`,
                                      cursor: "help",
                                    }}
                                  >
                                    + Add {prevQuarter} report to compare
                                  </span>
                                </div>
                              )}
                              {(consistencyDisplay || mgmtConf) && (
                                <div style={{ marginTop: "5px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                                  {consistencyDisplay && (
                                    <span
                                      title={consistencyData.note}
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: 600,
                                        color: consistencyDisplay.color,
                                        background: consistencyDisplay.color + "18",
                                        borderRadius: "3px",
                                        padding: "1px 5px",
                                        letterSpacing: "0.02em",
                                        cursor: "default",
                                      }}
                                    >
                                      {consistencyDisplay.label}
                                    </span>
                                  )}
                                  {mgmtConf && (
                                    <span
                                      title={mgmtConf.reason}
                                      style={{
                                        fontSize: "10px",
                                        fontWeight: 700,
                                        color: mgmtConfidenceColor(mgmtConf.score),
                                        background: mgmtConfidenceColor(mgmtConf.score) + "18",
                                        borderRadius: "3px",
                                        padding: "1px 5px",
                                        cursor: "default",
                                      }}
                                    >
                                      {mgmtConf.score}/10
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td style={{ padding: "11px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
                          {hasAnySource && (
                            <button
                              onClick={() => toggleRowExpanded(r.id)}
                              className="icon-btn"
                              style={{
                                background: "none",
                                border: "none",
                                color: isExpanded ? t.accent : t.inkMuted,
                                opacity: isExpanded ? 1 : 0.7,
                                cursor: "pointer",
                                fontSize: "11px",
                                padding: "0 6px",
                              }}
                              aria-label={isExpanded ? "Hide sources" : "Show sources"}
                              title={isExpanded ? "Hide sources" : "Show sources"}
                            >
                              {isExpanded ? "▾ Hide quote" : "▸ View quote"}
                            </button>
                          )}
                          {session && (
                            <button
                              onClick={async () => {
                                const entry = { id: r.id, file: r.file, name: r.fileName, status: STATUS.QUEUED, error: null };
                                if (!r.file) return;
                                setRows(prev => prev.map(row => row.id === r.id ? { ...row, mintedAt: Date.now() } : row));
                                const rowData = await extractViaBackend(r.file, columnsRef.current, sessionRef.current, true);
                                setRows(prev => prev.map(row => row.id === r.id ? { ...row, data: rowData, mintedAt: Date.now() } : row));
                              }}
                              className="icon-btn"
                              style={{ background: "none", border: "none", color: t.inkMuted, opacity: 0.7, cursor: "pointer", fontSize: "10px", padding: "0 4px", whiteSpace: "nowrap" }}
                              title="Re-extract this report fresh from the PDF"
                            >
                              Re-extract
                            </button>
                          )}
                          <button
                            onClick={() => removeRow(r.id)}
                            className="icon-btn"
                            style={{
                              background: "none",
                              border: "none",
                              color: t.inkMuted,
                              opacity: 0.7,
                              cursor: "pointer",
                              fontSize: "10px",
                              whiteSpace: "nowrap",
                            }}
                            aria-label={`Remove row for ${getCellValue(r.data["Company Name"]) || r.fileName}`}
                            title="Remove this row"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ borderBottom: `1px solid ${t.hairline}` }}>
                          <td
                            colSpan={columns.length + 1}
                            style={{
                              padding: "4px 16px 12px",
                              background: idx % 2 === 0 ? t.panel : t.bgSubtle,
                            }}
                          >
                            <div style={{
                              padding: "12px 16px",
                              background: t.bg,
                              borderRadius: "6px",
                              border: `1px solid ${t.hairline}`,
                              display: "flex",
                              flexDirection: "column",
                              gap: "10px"
                            }}>
                              <span className="mono" style={{ fontSize: "10px", color: t.inkFaint, letterSpacing: "0.05em", fontWeight: 600 }}>
                                VERIFIABLE CITATIONS
                              </span>
                              {citableColumns.map((c) => {
                                const quote = getCellSource(r.data[c]);
                                const page = getCellPage(r.data[c]);
                                const conf = getCellConfidence(r.data[c]);
                                const confDisplay = conf ? CONFIDENCE_DISPLAY[conf] : null;
                                const mgmtC = getMgmtConfidence(r.data[c]);
                                if (!quote) return null;
                                return (
                                  <div key={c} style={{ fontSize: "12px", lineHeight: "1.45" }}>
                                    <strong style={{ color: t.inkMuted, fontSize: "11.5px" }}>{c}:</strong>{" "}
                                    <span style={{ color: t.ink, fontStyle: "italic" }}>"{quote}"</span>
                                    {page > 0 && (
                                      <span className="mono" style={{ fontSize: "10px", color: t.inkFaint, marginLeft: "6px", background: t.bgSubtle, padding: "2px 5px", borderRadius: "3px" }}>
                                        p. {page}
                                      </span>
                                    )}
                                    {confDisplay && (
                                      <span
                                        title="Quote verification confidence"
                                        style={{
                                          fontSize: "10px",
                                          fontWeight: 700,
                                          color: confDisplay.color,
                                          background: confDisplay.color + "18",
                                          borderRadius: "3px",
                                          padding: "1px 5px",
                                          marginLeft: "6px",
                                          letterSpacing: "0.04em",
                                        }}
                                      >
                                        {confDisplay.label}
                                      </span>
                                    )}
                                    {mgmtC && (
                                      <span
                                        title={mgmtC.reason}
                                        style={{
                                          fontSize: "10px",
                                          fontWeight: 700,
                                          color: mgmtConfidenceColor(mgmtC.score),
                                          background: mgmtConfidenceColor(mgmtC.score) + "18",
                                          borderRadius: "3px",
                                          padding: "1px 5px",
                                          marginLeft: "6px",
                                        }}
                                      >
                                        mgmt {mgmtC.score}/10
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {/* Consistency feature teaser — shown to guests after first extraction */}
        {!session && rows.length > 0 && (
          <div
            style={{
              marginTop: "24px",
              padding: "16px 20px",
              background: t.panel,
              border: `1px solid ${t.hairline}`,
              borderLeft: `3px solid ${t.accent}`,
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "16px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
              <span style={{ fontSize: "18px", lineHeight: 1 }}>🔒</span>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: t.ink, marginBottom: "3px" }}>
                  Unlock consistency tracking
                </div>
                <div style={{ fontSize: "12px", color: t.inkMuted, lineHeight: 1.5 }}>
                  Sign in to see what management changed, maintained, or dropped compared to last quarter — automatically tracked across every report you upload.
                </div>
              </div>
            </div>
            <button
              onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } })}
              style={{
                flexShrink: 0,
                background: t.accent,
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                padding: "8px 16px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Sign in with Google →
            </button>
          </div>
        )}
        </div> {/* end main-content */}
      </div> {/* end sidebar+content flex */}

      {/* Pricing modal */}
      {pricingOpen && (
        <div
          onClick={() => setPricingOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: t.panel, borderRadius: "16px", maxWidth: "860px", width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.25)" }}
          >
            {/* Header */}
            <div style={{ padding: "28px 32px 20px", borderBottom: `1px solid ${t.hairline}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: "20px", fontWeight: 700, color: t.ink }}>Simple, transparent pricing</div>
                <div style={{ fontSize: "13px", color: t.inkMuted, marginTop: "4px" }}>You've hit your free tier limit. Upgrade to keep going — cancel anytime.</div>
              </div>
              <button onClick={() => setPricingOpen(false)} style={{ background: "none", border: "none", color: t.inkFaint, cursor: "pointer", fontSize: "22px", padding: "0 4px", lineHeight: 1 }}>×</button>
            </div>

            {/* Plans grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", padding: "24px 32px 32px" }}>
              {PLANS.map(plan => (
                <div
                  key={plan.name}
                  style={{
                    border: plan.highlight ? `2px solid ${t.accent}` : `1px solid ${t.hairline}`,
                    borderRadius: "12px",
                    padding: "22px 20px",
                    position: "relative",
                    background: plan.highlight ? t.accentBg : t.bg,
                    display: "flex", flexDirection: "column", gap: "12px",
                  }}
                >
                  {plan.highlight && (
                    <div style={{ position: "absolute", top: "-12px", left: "50%", transform: "translateX(-50%)", background: t.accent, color: "#fff", fontSize: "10px", fontWeight: 700, padding: "3px 10px", borderRadius: "20px", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>
                      MOST POPULAR
                    </div>
                  )}
                  <div style={{ fontSize: "13px", fontWeight: 700, color: t.ink, letterSpacing: "0.04em" }}>{plan.name.toUpperCase()}</div>
                  <div>
                    <div style={{ fontSize: "22px", fontWeight: 700, color: t.ink }}>{plan.price.in}</div>
                    <div style={{ fontSize: "11px", color: t.inkFaint }}>{plan.price.intl} international</div>
                  </div>
                  <div style={{ fontSize: "11.5px", color: t.accent, fontWeight: 600 }}>{plan.reports}</div>
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "7px", flex: 1 }}>
                    {plan.features.map(f => (
                      <li key={f} style={{ fontSize: "12px", color: t.inkMuted, display: "flex", gap: "7px", alignItems: "flex-start" }}>
                        <span style={{ color: t.accent, fontWeight: 700, flexShrink: 0 }}>✓</span> {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    disabled={plan.ctaDisabled || checkoutLoading === plan.name.toLowerCase()}
                    onClick={() => { if (!plan.ctaDisabled) handleUpgrade(plan.name.toLowerCase()); }}
                    style={{
                      marginTop: "8px", width: "100%", padding: "10px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 600,
                      cursor: plan.ctaDisabled ? "default" : "pointer",
                      background: plan.ctaDisabled ? t.bgSubtle : plan.highlight ? t.accent : t.ink,
                      color: plan.ctaDisabled ? t.inkFaint : "#fff",
                      border: "none",
                      opacity: (plan.ctaDisabled || checkoutLoading === plan.name.toLowerCase()) ? 0.7 : 1,
                    }}
                  >
                    {checkoutLoading === plan.name.toLowerCase() ? "Loading…" : plan.cta}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Glossary modal */}
      {glossaryOpen && (
        <div
          onClick={() => setGlossaryOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center", padding: "24px",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: t.panel, borderRadius: "14px", maxWidth: "540px", width: "100%",
              maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px 16px", borderBottom: `1px solid ${t.hairline}` }}>
              <div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: t.ink }}>Field Glossary</div>
                <div style={{ fontSize: "12px", color: t.inkMuted, marginTop: "2px" }}>What each column in your report tracks</div>
              </div>
              <button
                onClick={() => setGlossaryOpen(false)}
                style={{ background: "none", border: "none", color: t.inkFaint, cursor: "pointer", fontSize: "20px", padding: "0 4px" }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: "8px 0 16px" }}>
              {GLOSSARY.map(({ term, def }) => (
                <div key={term} style={{ padding: "14px 24px", borderBottom: `1px solid ${t.hairline}` }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: t.ink, marginBottom: "4px", fontFamily: "'JetBrains Mono', monospace" }}>
                    {term.toUpperCase()}
                  </div>
                  <div style={{ fontSize: "13px", color: t.inkMuted, lineHeight: 1.6 }}>{def}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

