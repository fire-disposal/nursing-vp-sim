import { api } from "./axios-instance";

export const getPractices = () => api.get("/admin/practices");
