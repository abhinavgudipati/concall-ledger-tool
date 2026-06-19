// import React, { useState, useCallback, useRef } from "react";

// // Backend base URL. Defaults to local dev; override at build time with
// // VITE_API_BASE_URL (Vite) or REACT_APP_API_BASE_URL (CRA) once deployed.
// const API_BASE_URL =
//   (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE_URL) ||
//   (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE_URL) ||
//   "http://localhost:8000";

// const DEFAULT_COLUMNS = [
//   "Company Name",
//   "Growth Guidance",
//   "Margin Guidance",
//   "Capex/Expansion",
//   "Order Book",
//   "Key Risk",
//   "Key Takeaway",
// ];

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
//   READING: "reading",
//   EXTRACTING: "extracting",
//   DONE: "done",
//   ERROR: "error",
// };

// export default function ConcallTool() {
//   const [columns, setColumns] = useState(DEFAULT_COLUMNS);
//   const [editingColumns, setEditingColumns] = useState(false);
//   const [columnDraft, setColumnDraft] = useState(DEFAULT_COLUMNS.join(", "));
//   const [files, setFiles] = useState([]); // {id, name, status, error}
//   const [rows, setRows] = useState([]); // {id, fileName, data, freshUntil}
//   const [isDragging, setIsDragging] = useState(false);
//   const [processing, setProcessing] = useState(false);
//   const fileInputRef = useRef(null);
//   const idCounter = useRef(0);

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

//   const processQueue = useCallback(async (entries) => {
//     setProcessing(true);
//     for (const entry of entries) {
//       setFiles((prev) =>
//         prev.map((f) => (f.id === entry.id ? { ...f, status: STATUS.EXTRACTING } : f))
//       );
//       try {
//         const rowData = await extractViaBackend(entry.file, columns);
//         const rowId = ++idCounter.current;
//         setRows((prev) => [
//           ...prev,
//           {
//             id: rowId,
//             fileName: entry.name,
//             data: rowData,
//             freshUntil: Date.now() + 4000,
//           },
//         ]);
//         setFiles((prev) =>
//           prev.map((f) => (f.id === entry.id ? { ...f, status: STATUS.DONE } : f))
//         );
//         setTimeout(() => {
//           setRows((prev) =>
//             prev.map((r) => (r.id === rowId ? { ...r, freshUntil: 0 } : r))
//           );
//         }, 4100);
//       } catch (err) {
//         setFiles((prev) =>
//           prev.map((f) =>
//             f.id === entry.id
//               ? { ...f, status: STATUS.ERROR, error: err.message }
//               : f
//           )
//         );
//       }
//     }
//     setProcessing(false);
//   }, [columns]);

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
//       .map((r) => `| ${columns.map((c) => (r.data[c] || "").replace(/\|/g, "/")).join(" | ")} |`)
//       .join("\n");
//     return [header, sep, body].join("\n");
//   };

//   const copyTable = async () => {
//     const md = exportMarkdown();
//     try {
//       await navigator.clipboard.writeText(md);
//     } catch (e) {
//       // fallback: select text isn't trivial in artifact sandbox; ignore silently
//     }
//   };

//   const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));
//   const removeFile = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));

//   const applyColumnEdit = () => {
//     const newCols = columnDraft
//       .split(",")
//       .map((c) => c.trim())
//       .filter(Boolean);
//     if (newCols.length > 0) setColumns(newCols);
//     setEditingColumns(false);
//   };

//   return (
//     <div
//       style={{
//         minHeight: "100vh",
//         background: "#F7F5F0",
//         color: "#1A1A1A",
//         fontFamily: "'Inter', -apple-system, sans-serif",
//         padding: "0",
//       }}
//     >
//       <style>{`
//         @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
//         * { box-sizing: border-box; }
//         .mono { font-family: 'JetBrains Mono', monospace; }
//         .ledger-row { transition: background-color 0.6s ease; }
//         @keyframes slideIn {
//           from { opacity: 0; transform: translateY(-6px); }
//           to { opacity: 1; transform: translateY(0); }
//         }
//         .row-enter { animation: slideIn 0.4s ease; }
//         @keyframes pulse {
//           0%, 100% { opacity: 1; }
//           50% { opacity: 0.4; }
//         }
//         .pulse { animation: pulse 1.4s ease-in-out infinite; }
//         button:focus-visible, input:focus-visible, textarea:focus-visible {
//           outline: 2px solid #3D5C45;
//           outline-offset: 2px;
//         }
//         @media (prefers-reduced-motion: reduce) {
//           .row-enter, .pulse { animation: none; }
//         }
//         .scrollbox::-webkit-scrollbar { height: 8px; width: 8px; }
//         .scrollbox::-webkit-scrollbar-thumb { background: #D8D4C8; border-radius: 4px; }
//       `}</style>

//       {/* Header */}
//       <div
//         style={{
//           borderBottom: "1px solid #D8D4C8",
//           padding: "28px 32px 20px",
//           display: "flex",
//           justifyContent: "space-between",
//           alignItems: "flex-end",
//           flexWrap: "wrap",
//           gap: "12px",
//         }}
//       >
//         <div>
//           <div
//             className="mono"
//             style={{ fontSize: "11px", letterSpacing: "0.12em", color: "#7A7666", marginBottom: "6px" }}
//           >
//             CONCALL INSIGHT EXTRACTOR
//           </div>
//           <h1 style={{ margin: 0, fontSize: "26px", fontWeight: 700, letterSpacing: "-0.01em" }}>
//             Earnings Call Ledger
//           </h1>
//         </div>
//         <div className="mono" style={{ fontSize: "12px", color: "#7A7666" }}>
//           {rows.length} {rows.length === 1 ? "transcript" : "transcripts"} processed
//         </div>
//       </div>

//       <div style={{ padding: "28px 32px 60px", maxWidth: "1400px", margin: "0 auto" }}>
//         {/* Column config */}
//         <div style={{ marginBottom: "20px" }}>
//           {!editingColumns ? (
//             <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
//               <span className="mono" style={{ fontSize: "11px", color: "#7A7666", letterSpacing: "0.06em" }}>
//                 EXTRACTING:
//               </span>
//               {columns.map((c) => (
//                 <span
//                   key={c}
//                   className="mono"
//                   style={{
//                     fontSize: "12px",
//                     background: "#FFFFFF",
//                     border: "1px solid #D8D4C8",
//                     borderRadius: "3px",
//                     padding: "3px 8px",
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
//                   color: "#3D5C45",
//                   fontSize: "12px",
//                   fontWeight: 600,
//                   cursor: "pointer",
//                   padding: "3px 4px",
//                   textDecoration: "underline",
//                 }}
//               >
//                 edit fields
//               </button>
//             </div>
//           ) : (
//             <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", flexWrap: "wrap" }}>
//               <textarea
//                 value={columnDraft}
//                 onChange={(e) => setColumnDraft(e.target.value)}
//                 rows={2}
//                 style={{
//                   flex: "1 1 400px",
//                   minWidth: "280px",
//                   padding: "8px 10px",
//                   border: "1px solid #B8B3A0",
//                   borderRadius: "4px",
//                   fontFamily: "'JetBrains Mono', monospace",
//                   fontSize: "12px",
//                   resize: "vertical",
//                   background: "#FFFFFF",
//                 }}
//                 placeholder="Comma-separated field names, e.g. Company Name, Growth Guidance, Margin Guidance"
//               />
//               <button
//                 onClick={applyColumnEdit}
//                 style={{
//                   background: "#3D5C45",
//                   color: "#F7F5F0",
//                   border: "none",
//                   borderRadius: "4px",
//                   padding: "9px 16px",
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
//                   border: "1px solid #D8D4C8",
//                   borderRadius: "4px",
//                   padding: "9px 16px",
//                   fontSize: "13px",
//                   cursor: "pointer",
//                   color: "#7A7666",
//                 }}
//               >
//                 Cancel
//               </button>
//             </div>
//           )}
//           <div className="mono" style={{ fontSize: "11px", color: "#A8432F", marginTop: "8px" }}>
//             Changing fields only affects transcripts processed after this point.
//           </div>
//         </div>

//         {/* Drop zone */}
//         <div
//           onDragOver={(e) => {
//             e.preventDefault();
//             setIsDragging(true);
//           }}
//           onDragLeave={() => setIsDragging(false)}
//           onDrop={onDrop}
//           onClick={() => fileInputRef.current?.click()}
//           style={{
//             border: `1.5px dashed ${isDragging ? "#3D5C45" : "#B8B3A0"}`,
//             borderRadius: "6px",
//             background: isDragging ? "#EDF1EA" : "#FFFFFF",
//             padding: "32px",
//             textAlign: "center",
//             cursor: "pointer",
//             transition: "all 0.2s ease",
//             marginBottom: "24px",
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
//           <div style={{ fontSize: "15px", fontWeight: 600, marginBottom: "4px" }}>
//             Drop concall transcript PDFs here
//           </div>
//           <div className="mono" style={{ fontSize: "12px", color: "#7A7666" }}>
//             or click to browse · processed one at a time, appended below as each finishes
//           </div>
//         </div>

//         {/* Queue status */}
//         {files.length > 0 && (
//           <div
//             className="scrollbox"
//             style={{
//               display: "flex",
//               gap: "8px",
//               marginBottom: "24px",
//               overflowX: "auto",
//               paddingBottom: "4px",
//             }}
//           >
//             {files.map((f) => (
//               <div
//                 key={f.id}
//                 className="mono"
//                 style={{
//                   flexShrink: 0,
//                   fontSize: "11px",
//                   border: `1px solid ${
//                     f.status === STATUS.ERROR ? "#A8432F" : f.status === STATUS.DONE ? "#3D5C45" : "#D8D4C8"
//                   }`,
//                   borderRadius: "4px",
//                   padding: "6px 10px",
//                   background: "#FFFFFF",
//                   display: "flex",
//                   alignItems: "center",
//                   gap: "6px",
//                   maxWidth: "240px",
//                 }}
//                 title={f.error || f.name}
//               >
//                 <span
//                   className={f.status === STATUS.READING || f.status === STATUS.EXTRACTING ? "pulse" : ""}
//                   style={{
//                     width: "6px",
//                     height: "6px",
//                     borderRadius: "50%",
//                     background:
//                       f.status === STATUS.ERROR
//                         ? "#A8432F"
//                         : f.status === STATUS.DONE
//                         ? "#3D5C45"
//                         : "#B8B3A0",
//                     flexShrink: 0,
//                   }}
//                 />
//                 <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
//                   {f.name}
//                 </span>
//                 <span style={{ color: "#7A7666" }}>
//                   {f.status === STATUS.QUEUED && "queued"}
//                   {f.status === STATUS.READING && "reading…"}
//                   {f.status === STATUS.EXTRACTING && "extracting…"}
//                   {f.status === STATUS.DONE && "done"}
//                   {f.status === STATUS.ERROR && "failed"}
//                 </span>
//                 <button
//                   onClick={() => removeFile(f.id)}
//                   style={{
//                     background: "none",
//                     border: "none",
//                     color: "#A8A399",
//                     cursor: "pointer",
//                     fontSize: "13px",
//                     padding: "0 2px",
//                     lineHeight: 1,
//                   }}
//                   aria-label={`Remove ${f.name} from queue`}
//                 >
//                   ×
//                 </button>
//               </div>
//             ))}
//           </div>
//         )}

//         {/* Table */}
//         {rows.length > 0 ? (
//           <>
//             <div
//               style={{
//                 display: "flex",
//                 justifyContent: "space-between",
//                 alignItems: "center",
//                 marginBottom: "10px",
//               }}
//             >
//               <div className="mono" style={{ fontSize: "11px", color: "#7A7666", letterSpacing: "0.06em" }}>
//                 RESULTS
//               </div>
//               <button
//                 onClick={copyTable}
//                 style={{
//                   background: "#FFFFFF",
//                   border: "1px solid #B8B3A0",
//                   borderRadius: "4px",
//                   padding: "7px 14px",
//                   fontSize: "12px",
//                   fontWeight: 600,
//                   cursor: "pointer",
//                   color: "#1A1A1A",
//                 }}
//               >
//                 Copy table as markdown
//               </button>
//             </div>
//             <div
//               className="scrollbox"
//               style={{
//                 overflowX: "auto",
//                 border: "1px solid #D8D4C8",
//                 borderRadius: "6px",
//                 background: "#FFFFFF",
//               }}
//             >
//               <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
//                 <thead>
//                   <tr style={{ background: "#1A1A1A" }}>
//                     {columns.map((c) => (
//                       <th
//                         key={c}
//                         className="mono"
//                         style={{
//                           color: "#F7F5F0",
//                           textAlign: "left",
//                           padding: "10px 14px",
//                           fontWeight: 600,
//                           fontSize: "11px",
//                           letterSpacing: "0.04em",
//                           whiteSpace: "nowrap",
//                         }}
//                       >
//                         {c.toUpperCase()}
//                       </th>
//                     ))}
//                     <th style={{ width: "32px" }}></th>
//                   </tr>
//                 </thead>
//                 <tbody>
//                   {rows.map((r, idx) => {
//                     const isFresh = r.freshUntil > Date.now();
//                     return (
//                       <tr
//                         key={r.id}
//                         className={`ledger-row ${isFresh ? "row-enter" : ""}`}
//                         style={{
//                           background: isFresh ? "#EDF1EA" : idx % 2 === 0 ? "#FFFFFF" : "#FAF8F3",
//                           borderBottom: "1px solid #EAE7DD",
//                         }}
//                       >
//                         {columns.map((c) => (
//                           <td
//                             key={c}
//                             style={{
//                               padding: "10px 14px",
//                               verticalAlign: "top",
//                               maxWidth: "260px",
//                               fontWeight: c === "Company Name" ? 600 : 400,
//                             }}
//                           >
//                             {r.data[c] || (
//                               <span style={{ color: "#B8B3A0" }} className="mono">
//                                 —
//                               </span>
//                             )}
//                           </td>
//                         ))}
//                         <td style={{ padding: "10px 8px", textAlign: "right" }}>
//                           <button
//                             onClick={() => removeRow(r.id)}
//                             style={{
//                               background: "none",
//                               border: "none",
//                               color: "#B8B3A0",
//                               cursor: "pointer",
//                               fontSize: "14px",
//                             }}
//                             aria-label={`Remove row for ${r.data["Company Name"] || r.fileName}`}
//                           >
//                             ×
//                           </button>
//                         </td>
//                       </tr>
//                     );
//                   })}
//                 </tbody>
//               </table>
//             </div>
//           </>
//         ) : (
//           files.length === 0 && (
//             <div
//               className="mono"
//               style={{
//                 textAlign: "center",
//                 color: "#A8A399",
//                 fontSize: "12px",
//                 padding: "20px 0",
//               }}
//             >
//               No transcripts processed yet — drop a PDF above to start the ledger.
//             </div>
//           )
//         )}
//       </div>
//     </div>
//   );
// }

import React, { useState, useCallback, useRef, useEffect } from "react";

// Backend base URL. Defaults to local dev; override at build time with
// VITE_API_BASE_URL (Vite) or REACT_APP_API_BASE_URL (CRA) once deployed.
const API_BASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE_URL) ||
  (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE_URL) ||
  "http://localhost:8000";

const DEFAULT_COLUMNS = [
  "Company Name",
  "Growth Guidance",
  "Margin Guidance",
  "Capex/Expansion",
  "Order Book",
  "Key Risk",
  "Key Takeaway",
];

const THEMES = {
  light: {
    bg: "#FAFAF8",
    bgSubtle: "#F2F1EC",
    panel: "#FFFFFF",
    ink: "#13151A",
    inkMuted: "#5B6B5E",
    inkFaint: "#9B9D94",
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

function buildPrompt() {} // (unused placeholder removed below — kept tree-shake friendly)

async function extractViaBackend(file, columns) {
  const formData = new FormData();
  formData.append("file", file);

  const params = new URLSearchParams({ columns: columns.join(",") });
  // Check your fetch or axios paths. It should look like this:
  const response = await fetch(`${import.meta.env.VITE_API_URL}/extract-batch`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const errBody = await response.json();
      if (errBody?.detail) detail = errBody.detail;
    } catch (_) {
      // response wasn't JSON — keep generic message
    }
    throw new Error(detail);
  }

  const data = await response.json();
  return data.row || {};
}

const STATUS = {
  QUEUED: "queued",
  EXTRACTING: "extracting",
  DONE: "done",
  ERROR: "error",
};

export default function ConcallTool() {
  const [theme, setTheme] = useState("light");
  const t = THEMES[theme];

  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [editingColumns, setEditingColumns] = useState(false);
  const [columnDraft, setColumnDraft] = useState(DEFAULT_COLUMNS.join(", "));
  const [files, setFiles] = useState([]);
  const [rows, setRows] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [copyState, setCopyState] = useState("idle"); // idle | copied
  const fileInputRef = useRef(null);
  const idCounter = useRef(0);

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

  const processQueue = useCallback(
    async (entries) => {
      for (const entry of entries) {
        setFiles((prev) =>
          prev.map((f) => (f.id === entry.id ? { ...f, status: STATUS.EXTRACTING } : f))
        );
        try {
          const rowData = await extractViaBackend(entry.file, columns);
          const rowId = ++idCounter.current;
          setRows((prev) => [
            ...prev,
            { id: rowId, fileName: entry.name, data: rowData, mintedAt: Date.now() },
          ]);
          setFiles((prev) =>
            prev.map((f) => (f.id === entry.id ? { ...f, status: STATUS.DONE } : f))
          );
        } catch (err) {
          setFiles((prev) =>
            prev.map((f) =>
              f.id === entry.id ? { ...f, status: STATUS.ERROR, error: err.message } : f
            )
          );
        }
      }
    },
    [columns]
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
      .map((r) => `| ${columns.map((c) => (r.data[c] || "").replace(/\|/g, "/")).join(" | ")} |`)
      .join("\n");
    return [header, sep, body].join("\n");
  };

  const copyTable = async () => {
    try {
      await navigator.clipboard.writeText(exportMarkdown());
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1800);
    } catch (_) {
      /* clipboard unavailable in this context; fail silently */
    }
  };

  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));
  const removeFile = (id) => setFiles((prev) => prev.filter((f) => f.id !== id));
  const retryFile = (entry) => {
    setFiles((prev) => prev.map((f) => (f.id === entry.id ? { ...f, status: STATUS.QUEUED, error: null } : f)));
    processQueue([entry]);
  };

  const applyColumnEdit = () => {
    const newCols = columnDraft.split(",").map((c) => c.trim()).filter(Boolean);
    if (newCols.length > 0) setColumns(newCols);
    setEditingColumns(false);
  };

  const activeCount = files.filter((f) => f.status === STATUS.EXTRACTING || f.status === STATUS.QUEUED).length;

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
        * { box-sizing: border-box; }
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
          .header-row { flex-direction: column; align-items: flex-start !important; gap: 14px; }
          .toolbar-row { flex-direction: column; align-items: stretch !important; }
          .toolbar-row > div:last-child { align-self: flex-end; }
        }
      `}</style>

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
            maxWidth: "1320px",
            margin: "0 auto",
            padding: "22px 32px",
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
              Ledger
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
              Concall Insight Extractor
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
            <span className="mono" style={{ fontSize: "11.5px", opacity: 0.6 }}>
              {rows.length} extracted{activeCount > 0 ? ` · ${activeCount} in progress` : ""}
            </span>
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
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "1320px", margin: "0 auto", padding: "36px 32px 72px" }}>
        {/* Intro line */}
        <p
          className="display"
          style={{
            fontSize: "26px",
            fontWeight: 500,
            lineHeight: 1.35,
            margin: "0 0 28px",
            maxWidth: "640px",
            color: t.ink,
          }}
        >
          Drop in transcripts. Pull out what management actually promised.
        </p>

        {/* Column config */}
        <div
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
          {!editingColumns ? (
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
                onClick={() => {
                  setColumnDraft(columns.join(", "));
                  setEditingColumns(true);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: t.accent,
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: "4px 6px",
                }}
              >
                Edit fields →
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", flexWrap: "wrap", width: "100%" }}>
              <textarea
                value={columnDraft}
                onChange={(e) => setColumnDraft(e.target.value)}
                rows={2}
                style={{
                  flex: "1 1 400px",
                  minWidth: "260px",
                  padding: "9px 11px",
                  border: `1px solid ${t.hairlineStrong}`,
                  borderRadius: "6px",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "12px",
                  resize: "vertical",
                  background: t.panel,
                  color: t.ink,
                }}
                placeholder="Comma-separated field names"
              />
              <button
                onClick={applyColumnEdit}
                style={{
                  background: t.accent,
                  color: t.bg,
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 18px",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Apply
              </button>
              <button
                onClick={() => setEditingColumns(false)}
                style={{
                  background: "none",
                  border: `1px solid ${t.hairline}`,
                  borderRadius: "6px",
                  padding: "10px 18px",
                  fontSize: "13px",
                  cursor: "pointer",
                  color: t.inkMuted,
                }}
              >
                Cancel
              </button>
            </div>
          )}

          <div style={{ flexShrink: 0 }}>
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
          </div>
        </div>

        {/* Drop zone */}
        <div
          className="dropzone"
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
            Drop transcript PDFs here, or click to browse
          </div>
          <div className="mono" style={{ fontSize: "11.5px", color: t.inkFaint }}>
            each file is read independently · a failed PDF won't block the rest
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
              const isActive = f.status === STATUS.EXTRACTING || f.status === STATUS.QUEUED;
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
                  }}
                  title={f.error || f.name}
                >
                  {isActive && (
                    <svg className="spinner" width="11" height="11" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                      <circle
                        cx="12" cy="12" r="9" fill="none"
                        stroke={t.inkFaint} strokeWidth="3"
                        strokeDasharray="14 30" strokeLinecap="round"
                      />
                    </svg>
                  )}
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
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
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
                  return (
                    <tr
                      key={r.id}
                      className={isFresh ? "print-in" : ""}
                      style={{
                        background: idx % 2 === 0 ? t.panel : t.bgSubtle,
                        borderBottom: `1px solid ${t.hairline}`,
                      }}
                    >
                      {columns.map((c) => {
                        const isTakeaway = c.toLowerCase().includes("takeaway");
                        const isRisk = c.toLowerCase().includes("risk");
                        return (
                          <td
                            key={c}
                            style={{
                              padding: "11px 16px",
                              verticalAlign: "top",
                              maxWidth: "260px",
                              fontWeight: c === "Company Name" ? 600 : 400,
                              color: isRisk && r.data[c] && r.data[c] !== "No explicit guidance" ? t.rust : t.ink,
                            }}
                          >
                            {r.data[c] ? (
                              <span
                                className={isTakeaway ? "takeaway-mark" : ""}
                                style={isTakeaway ? { "--mark-color": t.accentBg } : undefined}
                              >
                                {r.data[c]}
                              </span>
                            ) : (
                              <span style={{ color: t.inkFaint }} className="mono">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td style={{ padding: "11px 6px", textAlign: "right" }}>
                        <button
                          onClick={() => removeRow(r.id)}
                          className="icon-btn"
                          style={{ background: "none", border: "none", color: t.inkFaint, opacity: 0.5, cursor: "pointer", fontSize: "14px" }}
                          aria-label={`Remove row for ${r.data["Company Name"] || r.fileName}`}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          files.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "48px 0",
                border: `1px dashed ${t.hairline}`,
                borderRadius: "10px",
                color: t.inkFaint,
              }}
            >
              <div className="display" style={{ fontSize: "17px", color: t.inkMuted, marginBottom: "4px" }}>
                The ledger is empty
              </div>
              <div className="mono" style={{ fontSize: "11.5px" }}>
                drop a transcript above to start the first entry
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}