import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import "./ReportManager.css";

const TYPE_LABELS = { photo: "사진", video: "동영상", post: "게시글", diary: "다이어리", archive: "자료 누락" };

function ReportManager() {
  const [reports, setReports] = useState([]);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadReports(); }, []);

  async function loadReports() {
    setLoading(true);
    const { data, error } = await supabase
      .from("content_reports")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) alert(`제보를 불러오지 못했습니다.\n${error.message}`);
    else setReports(data || []);
    setLoading(false);
  }

  async function toggleResolved(report) {
    const nextStatus = report.status === "resolved" ? "pending" : "resolved";
    const { error } = await supabase
      .from("content_reports")
      .update({ status: nextStatus, resolved_at: nextStatus === "resolved" ? new Date().toISOString() : null })
      .eq("id", report.id);
    if (error) alert(error.message);
    else setReports((current) => current.map((item) => item.id === report.id ? { ...item, status: nextStatus } : item));
  }

  async function deleteReport(report) {
    if (!window.confirm("이 제보를 삭제할까요?")) return;
    const { error } = await supabase.from("content_reports").delete().eq("id", report.id);
    if (error) alert(error.message);
    else setReports((current) => current.filter((item) => item.id !== report.id));
  }

  const visible = useMemo(
    () => reports.filter((report) => status === "all" || report.status === status),
    [reports, status],
  );

  return (
    <div className="report-manager-page">
      <header className="report-manager-header">
        <button type="button" onClick={() => { window.location.href = "/admin"; }}>← 관리자 홈</button>
        <div><h1>제보함</h1><p>사진과 제보 내용을 한꺼번에 확인할 수 있습니다.</p></div>
      </header>
      <div className="report-manager-tabs">
        {[['pending', '미처리'], ['resolved', '처리 완료'], ['all', '전체']].map(([value, label]) => (
          <button type="button" key={value} className={status === value ? "active" : ""} onClick={() => setStatus(value)}>
            {label} {value === 'all' ? reports.length : reports.filter((item) => item.status === value).length}
          </button>
        ))}
      </div>
      <main className="report-manager-list">
        {loading && <div className="report-manager-empty">제보를 불러오는 중...</div>}
        {!loading && visible.length === 0 && <div className="report-manager-empty">해당 제보가 없습니다.</div>}
        {visible.map((report) => (
          <article className={`report-manager-card ${report.status}`} key={report.id}>
            <div className="report-manager-preview">
              {report.preview_url ? <img src={report.preview_url} alt="제보 대상" loading="lazy" /> : <span>NO IMAGE</span>}
            </div>
            <div className="report-manager-body">
              <div className="report-manager-meta">
                <strong>{TYPE_LABELS[report.target_type] || report.target_type}</strong>
                <span>{new Date(report.created_at).toLocaleString("ko-KR")}</span>
              </div>
              <div className="report-manager-target">{report.target_label || `ID ${report.target_id}`}</div>
              <p>{report.message}</p>
              <div className="report-manager-actions">
                {report.page_url && <a href={report.page_url} target="_blank" rel="noreferrer">대상 페이지 열기</a>}
                <button type="button" onClick={() => toggleResolved(report)}>
                  {report.status === "resolved" ? "미처리로 되돌리기" : "처리 완료"}
                </button>
                <button type="button" className="delete" onClick={() => deleteReport(report)}>삭제</button>
              </div>
            </div>
          </article>
        ))}
      </main>
    </div>
  );
}

export default ReportManager;
