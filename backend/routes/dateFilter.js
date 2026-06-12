function getValidDateRange(now = new Date()) {
  // minDate: 1st day of (current month - 2)
  const minDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  // maxDate: Last day of the current month, right before midnight
  const maxDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { minDate, maxDate };
}

function isValidEmailDate(msgDateStr, now = new Date()) {
  try {
    if (!msgDateStr) {
      console.warn(`Could not parse date: ${msgDateStr}`);
      return true;
    }
    const msgDate = new Date(msgDateStr);
    if (isNaN(msgDate.getTime())) {
      console.warn(`Could not parse date: ${msgDateStr}`);
      return true;
    }
    const { minDate, maxDate } = getValidDateRange(now);
    return msgDate >= minDate && msgDate <= maxDate;
  } catch (err) {
    console.warn(`Could not parse date: ${msgDateStr}`);
    return true;
  }
}

module.exports = { getValidDateRange, isValidEmailDate };