import "../../src/config/env";
import prisma from "../../src/config/prisma";
import BcryptService from "../../src/core/services/bcrypt.service";
import {
  AgentType,
  UserRole,
  UserStatus,
} from "../../src/generated/prisma/enums";

/**
 * Creates (or repairs) the SUPER_ADMIN login from env:
 *   SUPER_ADMIN_AGENT_ID  (default "SUPERADMIN") — the login id
 *   SUPER_ADMIN_EMAIL     (required)
 *   SUPER_ADMIN_PASSWORD  (required, ≥ 12 chars)
 *   SUPER_ADMIN_RESET_PASSWORD=true to overwrite an existing password
 *
 * Run: npm run seed:super-admin
 */
export async function seedSuperAdmin() {
  const agentId = process.env.SUPER_ADMIN_AGENT_ID?.trim() || "SUPERADMIN";
  const email = process.env.SUPER_ADMIN_EMAIL?.trim();
  const password = process.env.SUPER_ADMIN_PASSWORD;

  if (!email || !password) {
    console.log(
      "⏭️  SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set; skipping super admin.",
    );
    return;
  }

  if (password.length < 12) {
    throw new Error("SUPER_ADMIN_PASSWORD must be at least 12 characters.");
  }

  const existingAgent = await prisma.agent.findUnique({ where: { agentId } });

  if (existingAgent && existingAgent.type !== AgentType.ADMIN) {
    throw new Error(
      `Agent ${agentId} already exists as ${existingAgent.type}.`,
    );
  }

  if (!existingAgent) {
    await prisma.agent.create({
      data: {
        agentId,
        name: "Super Admin",
        type: AgentType.ADMIN,
        email,
        isProfileCompleted: true,
      },
    });
  }

  const existingUser = await prisma.user.findUnique({ where: { agentId } });

  const resetPassword = process.env.SUPER_ADMIN_RESET_PASSWORD === "true";

  if (!existingUser) {
    await prisma.user.create({
      data: {
        agentId,
        email,
        passwordHash: await new BcryptService().hash(password),
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        isEmailVerified: true,
        signupCompleted: true,
      },
    });

    console.log(`✅ Super admin ${agentId} created.`);

    return;
  }

  await prisma.user.update({
    where: { agentId },
    data: {
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      ...(resetPassword && {
        passwordHash: await new BcryptService().hash(password),
        passwordChangedAt: new Date(),
      }),
    },
  });

  console.log(
    `✅ Super admin ${agentId} already exists${resetPassword ? "; password reset" : ""}.`,
  );
}

if (require.main === module) {
  seedSuperAdmin()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
