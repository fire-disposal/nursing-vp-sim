import type { components } from "../api-types.gen";
import { api } from "../client";

type Schemas = components["schemas"];

export const submitFeedback = (data: Schemas["FeedbackSubmit"]) =>
	api.post<Schemas["FeedbackSubmitResponse"]>("/feedback", data);

export const getFeedbacks = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_FeedbackItem_"]>("/admin/feedback", {
		params,
	});

export const getFeedbackStats = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["FeedbackDailyItem"][]>("/admin/feedback/stats", { params });

export const replyFeedback = (feedbackId: number, reply: string) =>
	api.put<Schemas["FeedbackItem"]>(`/admin/feedback/${feedbackId}/reply`, { reply });

export const getMyFeedback = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_FeedbackItem_"]>("/my-feedback", { params });
