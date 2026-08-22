export function renderOrderReferralField(referral: string | null): string {
  if (referral) {
    return `<input type="hidden" name="recommenderWechatId" value="${escapeAttribute(referral)}" />`;
  }

  return '<label data-referral-entry="manual"><span>推荐人微信号</span><input name="recommenderWechatId" maxlength="32" required placeholder="填写推荐人的微信号" /></label>';
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character] ?? character);
}
