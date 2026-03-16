import jwt, { type JwtPayload } from "jsonwebtoken";

export type RegistrationFlowMethod = "email" | "google";

export class RegistrationFlowTokenError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "RegistrationFlowTokenError";
    this.status = status;
  }
}

interface RegistrationFlowTokenPayload extends JwtPayload {
  typ: "registration_flow";
  method: RegistrationFlowMethod;
  email: string;
  name?: string;
}

const REGISTRATION_TOKEN_TTL_SECONDS = 30 * 60;

const getRegistrationFlowSecret = (): string => {
  const secret =
    process.env.AUTH_FLOW_SECRET?.trim() || process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new RegistrationFlowTokenError(
      "AUTH_FLOW_SECRET or JWT_SECRET is not configured.",
      500,
    );
  }

  return secret;
};

export const issueRegistrationFlowToken = (payload: {
  method: RegistrationFlowMethod;
  email: string;
  name?: string;
}) => {
  const expiresAt = new Date(
    Date.now() + REGISTRATION_TOKEN_TTL_SECONDS * 1000,
  );

  const token = jwt.sign(
    {
      typ: "registration_flow",
      method: payload.method,
      email: payload.email,
      name: payload.name?.trim() || undefined,
    } satisfies RegistrationFlowTokenPayload,
    getRegistrationFlowSecret(),
    { expiresIn: REGISTRATION_TOKEN_TTL_SECONDS },
  );

  return {
    token,
    expiresAt,
  };
};

export const verifyRegistrationFlowToken = (
  token: string,
): RegistrationFlowTokenPayload => {
  let decoded: RegistrationFlowTokenPayload;

  try {
    decoded = jwt.verify(
      token,
      getRegistrationFlowSecret(),
    ) as RegistrationFlowTokenPayload;
  } catch {
    throw new RegistrationFlowTokenError(
      "Registration token is invalid or expired.",
      401,
    );
  }

  if (
    decoded.typ !== "registration_flow" ||
    (decoded.method !== "email" && decoded.method !== "google") ||
    typeof decoded.email !== "string" ||
    !decoded.email.trim()
  ) {
    throw new RegistrationFlowTokenError(
      "Registration token payload is invalid.",
      401,
    );
  }

  return {
    ...decoded,
    email: decoded.email.trim().toLowerCase(),
    name: typeof decoded.name === "string" ? decoded.name.trim() : undefined,
  };
};
