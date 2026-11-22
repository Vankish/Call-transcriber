import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { notFound } from "./errors";
import { interviewBundle } from "./interviewBundle";
import { permits, requireAccess } from "./requireAccess";
import { requireUser } from "./requireUser";
import {
  candidateDoc,
  interviewDoc,
  mediaSummary,
  memberRole,
  projectDoc,
  transcriptDoc,
} from "./validators";

/**
 * Lo que ven coaches y compañeros en la web (`/` e `/i/{interviewId}`).
 */

// Una lista para elegir llamada, no un archivo: con esto basta y no crece sin
// límite con los años de grabaciones del dueño.
const LIST_LIMIT = 200;
const PER_PROJECT = 100;

const interviewListItem = v.object({
  _id: v.id("interview"),
  workspaceId: v.id("workspace"),
  projectId: v.id("project"),
  projectName: v.string(),
  projectKind: projectDoc.fields.kind,
  projectCompany: v.string(),
  candidateName: v.string(),
  sessionName: v.string(),
  interviewerName: v.string(),
  durationSec: v.number(),
  transcriptionStatus: interviewDoc.fields.transcriptionStatus,
  summaryContext: interviewDoc.fields.summaryContext,
  createdAt: v.number(),
  // Para el icono de la lista: si hay vídeo terminado de subir.
  hasVideo: v.boolean(),
});

export const myInterviews = query({
  args: { projectId: v.optional(v.id("project")) },
  returns: v.array(interviewListItem),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const projects: Doc<"project">[] = [];
    if (args.projectId !== undefined) {
      const { project } = await requireAccess(ctx, { projectId: args.projectId }, "read");
      if (project !== null) projects.push(project);
    } else {
      const members = await ctx.db
        .query("member")
        .withIndex("by_user_id", (q) => q.eq("userId", userId))
        .collect();
      for (const member of members) {
        if (member.status !== "active") continue;
        const ids: Id<"project">[] =
          member.role === "owner" || member.role === "admin"
            ? (
                await ctx.db
                  .query("project")
                  .withIndex("by_workspace_id", (q) =>
                    q.eq("workspaceId", member.workspaceId),
                  )
                  .collect()
              ).map((p) => p._id)
            : member.projectIds;
        for (const id of ids) {
          const project = await ctx.db.get(id);
          if (
            project !== null &&
            project.deletedAt === undefined &&
            project.workspaceId === member.workspaceId &&
            permits(member, project._id, "read")
          ) {
            projects.push(project);
          }
        }
      }
    }

    const items = [];
    for (const project of projects) {
      const interviews = await ctx.db
        .query("interview")
        .withIndex("by_project_id", (q) => q.eq("projectId", project._id))
        .order("desc")
        .take(PER_PROJECT);
      for (const interview of interviews) {
        if (interview.deletedAt !== undefined) continue;
        const candidate = await ctx.db.get(interview.candidateId);
        if (candidate === null || candidate.deletedAt !== undefined) continue;
        const videos = await ctx.db
          .query("media")
          .withIndex("by_interview_id_and_kind", (q) =>
            q.eq("interviewId", interview._id).eq("kind", "video"),
          )
          .collect();
        items.push({
          _id: interview._id,
          workspaceId: interview.workspaceId,
          projectId: project._id,
          projectName: project.name,
          projectKind: project.kind,
          projectCompany: project.company,
          candidateName: candidate.name,
          sessionName: interview.sessionName,
          interviewerName: interview.interviewerName,
          durationSec: interview.durationSec,
          transcriptionStatus: interview.transcriptionStatus,
          summaryContext: interview.summaryContext,
          createdAt: interview.createdAt,
          hasVideo: videos.some((m) => m.uploadStatus === "done" && m.deletedAt === undefined),
        });
      }
    }
    items.sort((a, b) => b.createdAt - a.createdAt);
    return items.slice(0, LIST_LIMIT);
  },
});

/**
 * Una llamada entera para la web. Es consulta (y no mutación) para que la
 * página se actualice sola cuando llega la transcripción o un archivo; por eso
 * no puede escribir en `accessLog`: eso lo hace `viewer.markViewed`, que la web
 * llama una vez al abrir la página. Ver el informe del frente A.
 */
export const interview = query({
  args: { interviewId: v.id("interview") },
  returns: v.object({
    interview: interviewDoc,
    candidate: candidateDoc,
    project: projectDoc,
    transcript: v.union(transcriptDoc, v.null()),
    media: v.array(mediaSummary),
    access: v.object({
      role: memberRole,
      canComment: v.boolean(),
      canWrite: v.boolean(),
    }),
  }),
  handler: async (ctx, { interviewId }) => {
    const { interview, member } = await requireAccess(ctx, { interviewId }, "read");
    if (interview === null) throw notFound();
    const bundle = await interviewBundle(ctx.db, interview);
    if (bundle === null) throw notFound();
    return {
      ...bundle,
      access: {
        role: member.role,
        canComment: permits(member, interview.projectId, "comment"),
        canWrite: permits(member, interview.projectId, "write"),
      },
    };
  },
});

/** Apunta que alguien abrió la llamada (lo que el contrato pone en `viewer.interview`). */
export const markViewed = mutation({
  args: { interviewId: v.id("interview") },
  returns: v.null(),
  handler: async (ctx, { interviewId }) => {
    const { member, workspaceId } = await requireAccess(ctx, { interviewId }, "read");
    await ctx.db.insert("accessLog", {
      workspaceId,
      interviewId,
      memberId: member._id,
      action: "view",
      at: Date.now(),
    });
    return null;
  },
});
