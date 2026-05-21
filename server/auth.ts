import crypto from "node:crypto";
import { Request, RequestHandler, Response } from "express";

const COOKIE_NAME = "investment_planner_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function getPassword() {
  return process.env.APP_PASSWORD?.trim() ?? "";
}

function secureCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signSession(issuedAt: string) {
  return crypto.createHmac("sha256", getPassword()).update(`investment-planner:${issuedAt}`).digest("hex");
}

function createSessionToken() {
  const issuedAt = String(Date.now());
  return `${issuedAt}.${signSession(issuedAt)}`;
}

function getCookie(req: Request, name: string) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return "";

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const cookie = cookies.find((item) => item.startsWith(`${name}=`));
  if (!cookie) return "";

  return decodeURIComponent(cookie.slice(name.length + 1));
}

function isSessionValid(req: Request) {
  const password = getPassword();
  if (!password) return true;

  const token = getCookie(req, COOKIE_NAME);
  const [issuedAt, signature] = token.split(".");
  if (!issuedAt || !signature) return false;

  const issuedAtNumber = Number(issuedAt);
  if (!Number.isFinite(issuedAtNumber)) return false;

  const ageSeconds = (Date.now() - issuedAtNumber) / 1000;
  if (ageSeconds < 0 || ageSeconds > SESSION_MAX_AGE_SECONDS) return false;

  return secureCompare(signature, signSession(issuedAt));
}

function sessionCookie(value: string) {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`
  ];

  if (process.env.NODE_ENV === "production") attributes.push("Secure");
  return attributes.join("; ");
}

function expiredSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function assertAuthConfig() {
  if (process.env.NODE_ENV === "production" && !getPassword()) {
    throw new Error("APP_PASSWORD is required in production.");
  }

  if (!getPassword()) {
    console.warn("APP_PASSWORD is not set. API password protection is disabled for this environment.");
  }
}

export const authStatus: RequestHandler = (req, res) => {
  res.json({
    enabled: Boolean(getPassword()),
    authenticated: isSessionValid(req)
  });
};

export const login: RequestHandler = (req, res) => {
  const password = getPassword();
  if (!password) {
    res.json({ authenticated: true });
    return;
  }

  const submittedPassword = typeof req.body?.password === "string" ? req.body.password : "";
  if (!secureCompare(submittedPassword, password)) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  res.setHeader("Set-Cookie", sessionCookie(createSessionToken()));
  res.json({ authenticated: true });
};

export const logout: RequestHandler = (_req, res) => {
  res.setHeader("Set-Cookie", expiredSessionCookie());
  res.json({ authenticated: false });
};

export const requireAuth: RequestHandler = (req, res, next) => {
  if (isSessionValid(req)) {
    next();
    return;
  }

  res.status(401).json({ error: "Authentication required" });
};
