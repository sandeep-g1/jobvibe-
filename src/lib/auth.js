// Authentication — email + password, dependency-free.
//
// Passwords are hashed with scrypt (node:crypto), salted per user. Sessions are
// opaque random tokens stored in the sessions table and carried in an HttpOnly
// cookie, so a session can be revoked server-side (unlike a stateless JWT).
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import {
  createUserRow, userByEmail, userById, touchLogin,
  createSession, sessionUser, deleteSession, saveProfileRow, getProfileRow,
} from '../db.js';

const SESSION_DAYS = 30;

/* ---------------- password hashing ---------------- */

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, saltB, hashB] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB, 'base64');
    const expected = Buffer.from(hashB, 'base64');
    const actual = scryptSync(String(password), salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ---------------- validation ---------------- */

export function validEmail(e) {
  return typeof e === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim()) && e.length <= 254;
}

/* ---------------- signup / login ---------------- */

/**
 * Create an account and its starter profile.
 * @returns {{ ok:boolean, userId?:string, error?:string }}
 */
export async function signup({ email, password, name }) {
  email = String(email || '').trim().toLowerCase();
  if (!validEmail(email)) return { ok: false, error: 'Enter a valid email address.' };
  if (String(password || '').length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
  if (await userByEmail(email)) return { ok: false, error: 'An account with that email already exists.' };

  const id = randomUUID();
  await createUserRow({
    id, email, passwordHash: hashPassword(password),
    displayName: (name || email.split('@')[0]).trim(),
  });

  // Starter profile: schedule OFF by default (the requirement). The user turns
  // it on in Settings once they have set up their search.
  await saveProfileRow(starterProfile({ id, email, name }), id);
  return { ok: true, userId: id };
}

export async function login({ email, password }) {
  email = String(email || '').trim().toLowerCase();
  const user = await userByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return { ok: false, error: 'Email or password is incorrect.' };
  }
  await touchLogin(user.id);
  return { ok: true, userId: user.id };
}

export async function startSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await createSession({ token, userId, expiresAt: expires });
  return { token, expires };
}

export async function endSession(token) {
  if (token) await deleteSession(token);
}

/** Resolve the session cookie to a user, or null. */
export async function currentUser(req) {
  const token = readCookie(req, 'sid');
  if (!token) return null;
  const u = await sessionUser(token);
  return u || null;
}

export function sessionCookie(token, expires) {
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(expires).toUTCString()}`;
}
export function clearCookie() {
  return 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function starterProfile({ id, email, name }) {
  return {
    userId: id,
    name: (name || email.split('@')[0]).trim(),
    totalExpYears: 0,
    baseCity: 'bengaluru',
    jobTitles: [],
    preferredLocations: ['bengaluru', 'remote'],
    workModes: ['On-site', 'Hybrid', 'Remote'],
    sources: ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'himalayas', 'cutshort'],
    skillBank: [],
    resumeText: '',
    minScore: 45,
    dailyLimit: 60,
    excludeKeywords: ['intern', 'internship'],
    excludeCompanies: [],
    scheduleActive: false, // OFF by default — the requirement
    emailEnabled: true,
    emailTo: [email],
    emailCc: [],
  };
}

export { userById };
