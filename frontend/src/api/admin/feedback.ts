import type { components } from "../api-types.gen";
import { api } from "../client";

type Schemas = components["schemas"];

export const submitFeedbackFormData = (formData: FormData) =>
	api.post<Schemas["FeedbackSubmitResponse"]>("/feedback", formData);

export function feedbackImageUrl(feedbackId: number, imageId: number): string {
	return `/api/feedback/${feedbackId}/images/${imageId}`;
}

export const getFeedbacks = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_FeedbackItem_"]>("/admin/feedback", {
		params,
	});

export const getFeedbackStats = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["FeedbackDailyItem"][]>("/admin/feedback/stats", { params });

export const getFeedbackStorageStats = () =>
	api.get<{ total_images: number; total_bytes: number; total_mb: number }>(
		"/admin/feedback/storage-stats",
	);

export const replyFeedback = (feedbackId: number, reply: string) =>
	api.put<Schemas["FeedbackItem"]>(`/admin/feedback/${feedbackId}/reply`, { reply });

export const getMyFeedback = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_FeedbackItem_"]>("/my-feedback", { params });
