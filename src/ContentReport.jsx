import { useState } from "react";
import { supabase } from "./supabaseClient";
import "./ContentReport.css";

function ContentReport({ target, onClose }) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  if (!target) return null;

  async function submit(event) {
    event.preventDefault();
    const cleaned = message.trim();
    if (cleaned.length < 5) return;

    setSaving(true);
    const { error } = await supabase.rpc("create_content_report", {
      p_target_type: target.type,
      p_target_id: String(target.id),
      p_target_label: target.label || null,
      p_preview_url: target.previewUrl || null,
      p_page_url: target.pageUrl || window.location.href,
      p_message: cleaned,
    });
    setSaving(false);

    if (error) {
      alert(`제보를 보내지 못했습니다.\n${error.message}`);
      return;
    }
    setDone(true);
  }

  return (
    <div className="content-report-backdrop" onClick={onClose}>
      <form className="content-report-dialog" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="content-report-close" onClick={onClose}>×</button>
        {done ? (
          <div className="content-report-done">
            <strong>제보를 보냈습니다.</strong>
            <p>확인한 뒤 아카이브에 반영할게요. 감사합니다!</p>
            <button type="button" onClick={onClose}>닫기</button>
          </div>
        ) : (
          <>
            <small>ARCHIVE REPORT</small>
            <h2>제보하기</h2>
            {target.previewUrl && <img className="content-report-preview" src={target.previewUrl} alt="제보 대상" />}
            <div className="content-report-target">{target.label || `${target.type} #${target.id}`}</div>
            <label htmlFor="content-report-message">어떤 정보가 빠졌거나 잘못되었나요?</label>
            <textarea
              id="content-report-message"
              value={message}
              maxLength={500}
              autoFocus
              placeholder="예: 비니를 쓰고 있는데 비니 태그가 빠졌어요."
              onChange={(event) => setMessage(event.target.value)}
            />
            <div className="content-report-footer">
              <span>{message.length} / 500</span>
              <button type="submit" disabled={saving || message.trim().length < 5}>
                {saving ? "보내는 중…" : "제보 보내기"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

export default ContentReport;
