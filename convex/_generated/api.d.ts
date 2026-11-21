/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admitSignIn from "../admitSignIn.js";
import type * as auth from "../auth.js";
import type * as comment from "../comment.js";
import type * as errors from "../errors.js";
import type * as http from "../http.js";
import type * as interviewBundle from "../interviewBundle.js";
import type * as media from "../media.js";
import type * as member from "../member.js";
import type * as normalizeEmail from "../normalizeEmail.js";
import type * as r2 from "../r2.js";
import type * as rateLimit from "../rateLimit.js";
import type * as requireAccess from "../requireAccess.js";
import type * as requireUser from "../requireUser.js";
import type * as share from "../share.js";
import type * as shareToken from "../shareToken.js";
import type * as sync from "../sync.js";
import type * as validators from "../validators.js";
import type * as viewer from "../viewer.js";
import type * as workspace from "../workspace.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admitSignIn: typeof admitSignIn;
  auth: typeof auth;
  comment: typeof comment;
  errors: typeof errors;
  http: typeof http;
  interviewBundle: typeof interviewBundle;
  media: typeof media;
  member: typeof member;
  normalizeEmail: typeof normalizeEmail;
  r2: typeof r2;
  rateLimit: typeof rateLimit;
  requireAccess: typeof requireAccess;
  requireUser: typeof requireUser;
  share: typeof share;
  shareToken: typeof shareToken;
  sync: typeof sync;
  validators: typeof validators;
  viewer: typeof viewer;
  workspace: typeof workspace;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
