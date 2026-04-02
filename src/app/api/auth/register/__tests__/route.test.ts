import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";

const mockFindUnique = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("hashed_password"),
  },
}));

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when fields are missing", async () => {
    const res = await POST(makeRequest({ email: "test@test.com" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("All fields are required");
  });

  it("returns 400 when passwords do not match", async () => {
    const res = await POST(
      makeRequest({
        name: "Test",
        email: "test@test.com",
        password: "pass1",
        confirmPassword: "pass2",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Passwords do not match");
  });

  it("returns 409 when user already exists", async () => {
    mockFindUnique.mockResolvedValue({ id: "1", email: "test@test.com" });

    const res = await POST(
      makeRequest({
        name: "Test",
        email: "test@test.com",
        password: "password123",
        confirmPassword: "password123",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("User already exists");
  });

  it("returns 201 and creates user on success", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({
      id: "new-id",
      name: "Test",
      email: "test@test.com",
    });

    const res = await POST(
      makeRequest({
        name: "Test",
        email: "test@test.com",
        password: "password123",
        confirmPassword: "password123",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.user).toEqual({
      id: "new-id",
      name: "Test",
      email: "test@test.com",
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        name: "Test",
        email: "test@test.com",
        password: "hashed_password",
      },
    });
  });

  it("returns 500 on unexpected error", async () => {
    mockFindUnique.mockRejectedValue(new Error("DB connection failed"));

    const res = await POST(
      makeRequest({
        name: "Test",
        email: "test@test.com",
        password: "password123",
        confirmPassword: "password123",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Internal server error");
  });
});
