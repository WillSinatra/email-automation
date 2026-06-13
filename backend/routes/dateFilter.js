function getValidDateRange() {
  const now = new Date();

  const minDate = new Date(
    now.getFullYear(),
    now.getMonth() - 2,
    1,
    0, 0, 0, 0
  );

  const maxDate = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23, 59, 59, 999
  );

  return { minDate, maxDate };
}

function isValidEmailDate(dateStr) {
  if (!dateStr) return false;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return false;
    const { minDate, maxDate } = getValidDateRange();
    return date >= minDate && date <= maxDate;
  } catch {
    return false;
  }
}

function getRangeLabel() {
  const { minDate, maxDate } = getValidDateRange();
  const months = [
    'enero','febrero','marzo','abril','mayo','junio',
    'julio','agosto','septiembre','octubre','noviembre','diciembre'
  ];
  const fromMonth = months[minDate.getMonth()];
  const fromYear = minDate.getFullYear();
  const toMonth = months[maxDate.getMonth()];
  const toYear = maxDate.getFullYear();

  if (fromYear === toYear) {
    return `${fromMonth} – ${toMonth} ${toYear}`;
  }
  return `${fromMonth} ${fromYear} – ${toMonth} ${toYear}`;
}

module.exports = { getValidDateRange, isValidEmailDate, getRangeLabel };