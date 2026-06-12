export const metadata = { title: "服务条款 — Picsmith" };

const S = ({ t, children }) => (
  <section className="mb-8">
    <h2 className="text-white text-base font-bold mb-2">{t}</h2>
    <div className="text-secondary-text text-[13px] leading-relaxed flex flex-col gap-2">{children}</div>
  </section>
);

export default function Terms() {
  return (
    <div>
      <div className="micro-label mb-3">// TERMS OF SERVICE</div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight mb-2 text-white">服务条款</h1>
      <p className="text-gray-600 text-[12px] mb-10">最后更新：2026 年 6 月 12 日</p>

      <S t="1. 服务说明">
        <p>Picsmith（「本服务」）是一款 AI 设计生成工具，根据你的文字描述生成图像类设计内容。使用本服务即表示你同意本条款。</p>
      </S>
      <S t="2. 账号">
        <p>你需注册账号并对账号下的所有活动负责。请妥善保管登录凭据；如发现未授权使用，请立即联系我们。</p>
      </S>
      <S t="3. 积分与付费">
        <p>生成消耗积分，定价在产品内公示。已消耗的积分对应真实的计算成本，原则上不可逆；未消耗的充值积分退款见《退款政策》。生成失败的部分自动退还对应积分。</p>
      </S>
      <S t="4. 可接受使用（AUP）">
        <p>禁止使用本服务生成：违法内容、侵犯他人知识产权或肖像权的内容、色情或暴力内容、歧视或仇恨内容、虚假信息或冒充他人的内容。我们有权对违规账号限制或终止服务，已消耗积分不予退还。</p>
      </S>
      <S t="5. 生成内容的权利">
        <p>在你遵守本条款的前提下，你对通过本服务生成的内容拥有使用权，可用于商业用途。你理解 AI 生成内容可能与他人的生成结果相似，且在部分司法辖区的版权地位尚不明确。</p>
      </S>
      <S t="6. 免责声明">
        <p>本服务按「现状」提供。我们不保证服务不中断、生成结果符合特定预期。在法律允许的最大范围内，我们的责任以你过去 12 个月内向我们支付的费用为限。</p>
      </S>
      <S t="7. 条款变更">
        <p>我们可能更新本条款，重大变更会在产品内通知。继续使用即视为接受更新后的条款。</p>
      </S>
    </div>
  );
}
