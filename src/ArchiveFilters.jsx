function ArchiveFilters({
  type,
  setType,

  sortOrder,
  setSortOrder,

  startDate,
  setStartDate,

  endDate,
  setEndDate,

  typeLabel = "유형",

  allActive = false,
  onAllClick,
}) {
  return (
    <div className="filter-bar">
      <button
        type="button"
        className={`all-tab ${allActive ? "active" : ""}`}
        onClick={onAllClick}
      >
        전체
      </button>

      <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
        <option value="최신순">최신순</option>

        <option value="오래된순">오래된순</option>
      </select>

      <select value={type} onChange={(e) => setType(e.target.value)}>
        <option value="전체">{typeLabel}</option>

        <option value="셀카">셀카</option>

        <option value="남찍사">남찍사</option>

        <option value="거울셀카">거울셀카</option>

        <option value="그외">그외</option>
      </select>

      <div className="date-filter">
        <span>since</span>

        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />

        <span>until</span>

        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
    </div>
  );
}

export default ArchiveFilters;
