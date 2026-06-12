export const metadata = { title: "隐私政策 — Picsmith" };

const S = ({ t, children }) => (
  <section className="mb-8">
    <h2 className="text-white text-base font-bold mb-2">{t}</h2>
    <div className="text-secondary-text text-[13px] leading-relaxed flex flex-col gap-2">{children}</div>
  </section>
);

export default function Privacy() {
  return (
    <div>
      <div className="micro-label mb-3">// PRIVACY POLICY</div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight mb-2 text-white">隐私政策</h1>
      <p className="text-gray-600 text-[12px] mb-10">最后更新：2026 年 6 月 12 日</p>

      <S t="1. 我们收集什么">
        <p>账号信息（邮箱、昵称、加密后的密码）、你的设计描述与生成结果、上传的参考图、积分与订单记录、必要的访问日志（IP、时间）。</p>
      </S>
      <S t="2. 怎么使用">
        <p>仅用于提供服务（生成调度、账务、防滥用）。你的描述会发送给我们对接的 AI 模型服务以完成生成。<strong className="text-white">我们不会将你的内容用于训练模型，不会出售你的数据。</strong></p>
      </S>
      <S t="3. 第三方">
        <p>支付由 Stripe 处理（我们不接触你的卡号）；邮件由 Resend 发送；生成由 AI 模型服务商执行。它们各自的隐私政策适用于对应环节。</p>
      </S>
      <S t="4. 数据保留与删除">
        <p>账号存续期间我们保留你的项目数据。你可联系我们删除账号——届时生成历史与个人信息将被删除，法律要求保留的账务记录除外。</p>
      </S>
      <S t="5. 安全">
        <p>密码以 bcrypt 加密存储，传输全程 HTTPS。任何系统都无法保证绝对安全，发现漏洞请联系我们。</p>
      </S>
      <S t="6. 联系">
        <p>隐私相关问题请通过产品内入口或邮箱联系我们。</p>
      </S>
    </div>
  );
}
