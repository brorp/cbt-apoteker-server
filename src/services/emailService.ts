interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

type SendEmailResult = {
  delivered: boolean;
  provider: "resend" | "log";
  messageId?: string | null;
  error?: string | null;
};

const getEmailFrom = (): string =>
  process.env.EMAIL_FROM?.trim() || "CBT Apoteker <no-reply@cbt.local>";

const sendWithResend = async (
  input: SendEmailInput,
): Promise<SendEmailResult> => {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getEmailFrom(),
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error (${response.status}): ${body}`);
  }

  const body = (await response.json()) as { id?: string };
  return {
    delivered: true,
    provider: "resend",
    messageId: body.id ?? null,
  };
};

const sendWithLog = async (input: SendEmailInput): Promise<SendEmailResult> => {
  console.log("EMAIL_LOG", {
    to: input.to,
    subject: input.subject,
    text: input.text,
  });

  return {
    delivered: false,
    provider: "log",
    messageId: null,
    error: "Email provider is not configured. Email logged to stdout only.",
  };
};

export const sendEmail = async (
  input: SendEmailInput,
): Promise<SendEmailResult> => {
  try {
    if (process.env.RESEND_API_KEY?.trim()) {
      return await sendWithResend(input);
    }

    return await sendWithLog(input);
  } catch (error) {
    return {
      delivered: false,
      provider: process.env.RESEND_API_KEY?.trim() ? "resend" : "log",
      messageId: null,
      error: error instanceof Error ? error.message : "Unknown email error.",
    };
  }
};

export const buildQuestionReportReplyEmail = (input: {
  userName: string;
  packageName: string | null;
  questionText: string | null;
  reportText: string;
  adminReply: string;
}) => {
  const packageLine = input.packageName
    ? `Paket: ${input.packageName}`
    : "Paket: -";
  const questionLine = input.questionText
    ? `Soal: ${input.questionText}`
    : "Soal: -";

  return {
    subject: "Balasan Admin untuk Report Soal Anda",
    text: [
      `Halo ${input.userName},`,
      "",
      "Admin telah membalas report soal Anda.",
      packageLine,
      questionLine,
      "",
      "Report Anda:",
      input.reportText,
      "",
      "Balasan Admin:",
      input.adminReply,
      "",
      "Terima kasih.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
        <h2 style="margin-bottom:16px">Balasan Admin untuk Report Soal Anda</h2>
        <p>Halo <strong>${input.userName}</strong>,</p>
        <p>Admin telah membalas report soal Anda.</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:16px 0">
          <p style="margin:0 0 8px"><strong>${packageLine}</strong></p>
          <p style="margin:0">${questionLine}</p>
        </div>
        <p><strong>Report Anda:</strong></p>
        <p>${input.reportText}</p>
        <p><strong>Balasan Admin:</strong></p>
        <p>${input.adminReply}</p>
        <p>Terima kasih.</p>
      </div>
    `,
  };
};
