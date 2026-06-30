import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type NoteItem = components["schemas"]["NoteResponse"];
type NoteCreatePayload = components["schemas"]["NoteCreateRequest"];

export type { NoteCreatePayload, NoteItem };

export const listNotes = (recordId?: number) =>
	api.get<NoteItem[]>(`/notes${recordId ? `?record_id=${recordId}` : ""}` as ApiPath).then((r) => r.data);

export const createNote = (data: NoteCreatePayload) =>
	api.post<NoteItem>("/notes" as ApiPath, data).then((r) => r.data);

export const updateNote = (id: number, data: components["schemas"]["NoteUpdateRequest"]) =>
	api.put<NoteItem>(`/notes/${id}` as ApiPath, data).then((r) => r.data);

export const deleteNote = (id: number) =>
	api.delete(`/notes/${id}` as ApiPath);
