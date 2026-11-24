import { getActiveApiBaseUrl } from "../utils/apiBase";

const API_BASE_URL = () => getActiveApiBaseUrl();

function buildHeaders() {
  const token = localStorage.getItem("token");
  const headers = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function requestJson(path, options = {}) {
  const res = await fetch(`${API_BASE_URL()}${path}`, {
    ...options,
    headers: {
      ...buildHeaders(),
      ...(options.headers || {}),
    },
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const message = payload?.message || `Request failed with status ${res.status}`;
    throw new Error(message);
  }

  return payload;
}

export async function createPayment(studentId, amount) {
  return requestJson("/payments", {
    method: "POST",
    body: JSON.stringify({
      student_id: studentId,
      amount,
    }),
  });
}

export async function createConcession(studentId, amount, reason) {
  return requestJson("/concessions", {
    method: "POST",
    body: JSON.stringify({
      student_id: studentId,
      amount,
      reason,
    }),
  });
}

export async function getStudentSummary(studentId) {
  try {
    return await requestJson(`/student-summary/${studentId}`, {
      method: "GET",
    });
  } catch {
    return requestJson(`/students/${studentId}/summary`, {
      method: "GET",
    });
  }
}

