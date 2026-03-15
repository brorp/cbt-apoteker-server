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

export const buildRegistrationOtpEmail = (input: { otpCode: string }) => ({
  subject: "Kode OTP Verifikasi Email Anda",
  text: [
    "Verifikasi Email Anda",
    "",
    "Terima kasih telah melakukan registrasi.",
    `Gunakan kode OTP berikut untuk menyelesaikan proses verifikasi akun Anda: ${input.otpCode}`,
    "",
    "Kode OTP ini berlaku selama 5 menit.",
    "Jika Anda tidak merasa melakukan registrasi, silakan abaikan email ini.",
    "",
    "Email ini dikirim otomatis, mohon tidak membalas email ini.",
    "© 2026 Kumpulan Soal UKAI",
  ].join("\n"),
  html: `<!DOCTYPE html>
<html dir="ltr" lang="en">
  <head>
    <meta content="width=device-width" name="viewport" />
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta content="IE=edge" http-equiv="X-UA-Compatible" />
    <meta content="telephone=no,address=no,email=no,date=no,url=no" name="format-detection" />
  </head>
  <body>
    <table border="0" width="100%" cellpadding="0" cellspacing="0" role="presentation" align="center">
      <tbody>
        <tr>
          <td>
            <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Roboto','Oxygen','Ubuntu','Cantarell','Fira Sans','Droid Sans','Helvetica Neue',sans-serif;font-size:1.0769230769230769em;min-height:100%;line-height:155%">
              <tbody>
                <tr>
                  <td>
                    <table align="left" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="align:left;width:100%;padding-left:0;padding-right:0;line-height:155%;max-width:600px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Roboto','Oxygen','Ubuntu','Cantarell','Fira Sans','Droid Sans','Helvetica Neue',sans-serif">
                      <tbody>
                        <tr>
                          <td>
                            <div>
                              <table width="100%" cellpadding="0" cellspacing="0">
                                <tbody>
                                  <tr>
                                    <td align="center">
                                      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;margin-top:40px;border-radius:10px;padding:40px;box-shadow:0 4px 20px rgba(0,0,0,0.05);">
                                        <tbody>
                                          <tr>
                                            <td align="center">
                                              <h2 style="margin:0;color:#222;">Verifikasi Email Anda</h2>
                                              <p style="color:#555;font-size:14px;margin-top:10px;">
                                                Terima kasih telah melakukan registrasi. Gunakan kode OTP berikut untuk menyelesaikan proses verifikasi akun Anda.
                                              </p>
                                            </td>
                                          </tr>
                                          <tr>
                                            <td align="center" style="padding:30px 0;">
                                              <div style="font-size:34px;font-weight:bold;letter-spacing:8px;background:#f3f6ff;padding:18px 30px;border-radius:8px;display:inline-block;color:#111;">
                                                ${input.otpCode}
                                              </div>
                                            </td>
                                          </tr>
                                          <tr>
                                            <td align="center">
                                              <p style="font-size:14px;color:#666;">
                                                Kode OTP ini berlaku selama <b>5 menit</b>.
                                              </p>
                                              <p style="font-size:13px;color:#999;margin-top:25px;">
                                                Jika Anda tidak merasa melakukan registrasi, silakan abaikan email ini.
                                              </p>
                                            </td>
                                          </tr>
                                          <tr>
                                            <td align="center" style="padding-top:35px;border-top:1px solid #eee;">
                                              <p style="font-size:12px;color:#999;margin:0;">
                                                Email ini dikirim otomatis, mohon tidak membalas email ini.
                                              </p>
                                            </td>
                                          </tr>
                                        </tbody>
                                      </table>
                                      <p style="font-size:12px;color:#aaa;margin-top:20px;">© 2026 Kumpulan Soal UKAI</p>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                            <img
                              alt="Kumpulan Soal UKAI logo and contact information banner with blue and yellow branding."
                              src="https://resend-attachments.s3.amazonaws.com/0c2db1e7-dc9a-4cca-bb57-22b0698b7a85"
                              style="display:block;outline:none;border:none;text-decoration:none;max-width:100%;border-radius:8px"
                              width="100%"
                            />
                            <p style="margin:0;padding:0;font-size:1em;padding-top:0.5em;padding-bottom:0.5em"><br /></p>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`,
});
