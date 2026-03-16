export class GoogleIdentityServiceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "GoogleIdentityServiceError";
    this.status = status;
  }
}

interface GoogleTokenInfoResponse {
  aud?: string;
  email?: string;
  email_verified?: string;
  name?: string;
  picture?: string;
  sub?: string;
  iss?: string;
}

const getAllowedGoogleClientIds = (): string[] => {
  const configured =
    process.env.GOOGLE_CLIENT_ID?.trim() || process.env.AUTH_GOOGLE_ID?.trim();

  if (!configured) {
    throw new GoogleIdentityServiceError(
      "GOOGLE_CLIENT_ID or AUTH_GOOGLE_ID is not configured.",
      500,
    );
  }

  return configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
};

export const verifyGoogleIdToken = async (idToken: string) => {
  if (!idToken.trim()) {
    throw new GoogleIdentityServiceError("Google ID token is required.", 400);
  }

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new GoogleIdentityServiceError(
      "Google sign-in token is invalid or expired.",
      401,
    );
  }

  const payload = (await response.json()) as GoogleTokenInfoResponse;
  const allowedClientIds = getAllowedGoogleClientIds();

  if (!payload.aud || !allowedClientIds.includes(payload.aud)) {
    throw new GoogleIdentityServiceError(
      "Google sign-in token audience is not allowed.",
      401,
    );
  }

  if (
    payload.iss !== "accounts.google.com" &&
    payload.iss !== "https://accounts.google.com"
  ) {
    throw new GoogleIdentityServiceError(
      "Google sign-in token issuer is invalid.",
      401,
    );
  }

  if (payload.email_verified !== "true" || !payload.email?.trim()) {
    throw new GoogleIdentityServiceError(
      "Google account email is not verified.",
      403,
    );
  }

  if (!payload.sub?.trim()) {
    throw new GoogleIdentityServiceError(
      "Google account identifier is missing.",
      401,
    );
  }

  return {
    googleUserId: payload.sub.trim(),
    email: payload.email.trim().toLowerCase(),
    name: payload.name?.trim() || "",
    pictureUrl: payload.picture?.trim() || null,
  };
};
