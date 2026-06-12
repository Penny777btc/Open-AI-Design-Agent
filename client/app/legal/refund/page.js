export const metadata = { title: "退款政策 — Picsmith" };

const S = ({ t, children }) => (
  <section className="mb-8">
    <h2 className="text-white text-base font-bold mb-2">{t}</h2>
    <div className="text-secondary-text text-[13px] leading-relaxed flex flex-col gap-2">{children}</div>
  </section>
);

export default function Refund() {
  return (
    <div>
      <div className="micro-label mb-3">// REFUND POLICY</div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight mb-2 text-white">退款政策</h1>
      <p className="text-gray-600 text-[12px] mb-10">最后更新：2026 年 6 月 12 日</p>

      <S t="1. 自动退还（无需申请）">
        <p>生成失败的节点，其对应积分<strong className="text-white">自动原路退回账户</strong>；服务中断导致的未完成任务同样自动退还未消耗的预扣积分。这两类在积分流水中均可查证。</p>
      </S>
      <S t="2. 充值退款">
        <p>购买后 14 天内、且该笔充值的积分<strong className="text-white">未消耗任何部分</strong>的，可申请全额退款，原支付渠道退回（到账时间以 Stripe 为准）。已部分消耗的充值不支持按比例退款——因为每次生成都产生了真实的计算成本。</p>
      </S>
      <S t="3. 不适用退款的情形">
        <p>对生成结果的主观不满意（你在批准计划前可见全部消耗预估，且失败不收费）；违反服务条款被限制的账号；注册赠送的免费积分。</p>
      </S>
      <S t="4. 如何申请">
        <p>通过产品内联系入口提交订单号，我们会在 3 个工作日内处理。</p>
      </S>
    </div>
  );
}
