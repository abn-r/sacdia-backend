import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

@Injectable()
export class CamporeeLateApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertClubRegistrationOpenForPendingClub(
    record: { camporee_id: number | null; union_camporee_id: number | null },
    tx: any,
  ): Promise<void> {
    if (record.camporee_id) {
      const camporee = await tx.local_camporees.findUnique({
        where: { local_camporee_id: record.camporee_id },
        select: { club_registration_closed_at: true },
      });
      if (camporee?.club_registration_closed_at) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_CLUB_REGISTRATION_CLOSED,
        );
      }
      return;
    }

    if (record.union_camporee_id) {
      const camporee = await tx.union_camporees.findUnique({
        where: { union_camporee_id: record.union_camporee_id },
        select: { club_registration_closed_at: true },
      });
      if (camporee?.club_registration_closed_at) {
        throw new AppBadRequestException(
          ErrorCode.CAMPOREE_CLUB_REGISTRATION_CLOSED,
        );
      }
    }
  }

  /**
   * List all pending enrollments for a camporee (clubs, members, payments).
   */
  async listPending(camporeeId: number) {
    const [pendingClubs, pendingMembers, pendingPayments] = await Promise.all([
      this.prisma.camporee_clubs.findMany({
        where: {
          camporee_id: camporeeId,
          status: 'pending_approval',
          active: true,
        },
        include: { club_sections: true },
        orderBy: { created_at: 'asc' },
      }),
      this.prisma.camporee_members.findMany({
        where: {
          camporee_id: camporeeId,
          status: 'pending_approval',
          active: true,
        },
        include: {
          users: {
            select: {
              user_id: true,
              name: true,
              email: true,
              paternal_last_name: true,
              maternal_last_name: true,
              user_image: true,
            },
          },
        },
        orderBy: { created_at: 'asc' },
      }),
      this.prisma.camporee_payments.findMany({
        where: {
          status: 'pending_approval',
          camporee_member: { camporee_id: camporeeId },
        },
        include: {
          camporee_member: {
            include: {
              users: {
                select: {
                  user_id: true,
                  name: true,
                  email: true,
                  paternal_last_name: true,
                  maternal_last_name: true,
                },
              },
            },
          },
        },
        orderBy: { created_at: 'asc' },
      }),
    ]);

    return {
      clubs: pendingClubs,
      members: pendingMembers,
      payments: pendingPayments,
    };
  }

  /**
   * List all pending enrollments for a union camporee (clubs, members, payments).
   */
  async listUnionPending(unionCamporeeId: number) {
    const [pendingClubs, pendingMembers, pendingPayments] = await Promise.all([
      this.prisma.camporee_clubs.findMany({
        where: {
          union_camporee_id: unionCamporeeId,
          status: 'pending_approval',
          active: true,
        },
        include: { club_sections: true },
        orderBy: { created_at: 'asc' },
      }),
      this.prisma.camporee_members.findMany({
        where: {
          union_camporee_id: unionCamporeeId,
          status: 'pending_approval',
          active: true,
        },
        include: {
          users: {
            select: {
              user_id: true,
              name: true,
              email: true,
              paternal_last_name: true,
              maternal_last_name: true,
              user_image: true,
            },
          },
        },
        orderBy: { created_at: 'asc' },
      }),
      this.prisma.camporee_payments.findMany({
        where: {
          status: 'pending_approval',
          camporee_member: { union_camporee_id: unionCamporeeId },
        },
        include: {
          camporee_member: {
            include: {
              users: {
                select: {
                  user_id: true,
                  name: true,
                  email: true,
                  paternal_last_name: true,
                  maternal_last_name: true,
                },
              },
            },
          },
        },
        orderBy: { created_at: 'asc' },
      }),
    ]);

    return {
      clubs: pendingClubs,
      members: pendingMembers,
      payments: pendingPayments,
    };
  }

  // ============================================================
  // CLUB ENROLLMENT
  // ============================================================

  /**
   * Approve a pending club enrollment.
   */
  async approveClubEnrollment(camporeeClubId: number, approvedBy: string) {
    // Wrap check + update in a transaction to prevent a concurrent approval/rejection
    // from slipping between the findFirst and the update (check-then-act race condition).
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.camporee_clubs.findFirst({
        where: { camporee_club_id: camporeeClubId, status: 'pending_approval' },
      });

      if (!record) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_CLUB_ENROLLMENT_PENDING_NOT_FOUND,
        );
      }

      await this.assertClubRegistrationOpenForPendingClub(record, tx);

      return tx.camporee_clubs.update({
        where: { camporee_club_id: camporeeClubId },
        data: {
          status: 'approved',
          approved_by: approvedBy,
          modified_at: new Date(),
        },
      });
    });
  }

  /**
   * Reject a pending club enrollment.
   */
  async rejectClubEnrollment(
    camporeeClubId: number,
    rejectedBy: string,
    rejectionReason?: string,
  ) {
    // Wrap check + update in a transaction to prevent a concurrent approval/rejection
    // from slipping between the findFirst and the update (check-then-act race condition).
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.camporee_clubs.findFirst({
        where: { camporee_club_id: camporeeClubId, status: 'pending_approval' },
      });

      if (!record) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_CLUB_ENROLLMENT_PENDING_NOT_FOUND,
        );
      }

      return tx.camporee_clubs.update({
        where: { camporee_club_id: camporeeClubId },
        data: {
          status: 'rejected',
          rejected_by: rejectedBy,
          rejection_reason: rejectionReason ?? null,
          modified_at: new Date(),
        },
      });
    });
  }

  // ============================================================
  // MEMBER ENROLLMENT
  // ============================================================

  /**
   * Approve a pending member enrollment.
   */
  async approveMemberEnrollment(camporeeMemberId: number, approvedBy: string) {
    // Wrap check + update in a transaction to prevent a concurrent approval/rejection
    // from slipping between the findFirst and the update (check-then-act race condition).
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.camporee_members.findFirst({
        where: {
          camporee_member_id: camporeeMemberId,
          status: 'pending_approval',
        },
      });

      if (!record) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_MEMBER_ENROLLMENT_PENDING_NOT_FOUND,
        );
      }

      return tx.camporee_members.update({
        where: { camporee_member_id: camporeeMemberId },
        data: {
          status: 'approved',
          approved_by: approvedBy,
          modified_at: new Date(),
        },
      });
    });
  }

  /**
   * Reject a pending member enrollment.
   */
  async rejectMemberEnrollment(
    camporeeMemberId: number,
    rejectedBy: string,
    rejectionReason?: string,
  ) {
    // Wrap check + update in a transaction to prevent a concurrent approval/rejection
    // from slipping between the findFirst and the update (check-then-act race condition).
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.camporee_members.findFirst({
        where: {
          camporee_member_id: camporeeMemberId,
          status: 'pending_approval',
        },
      });

      if (!record) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_MEMBER_ENROLLMENT_PENDING_NOT_FOUND,
        );
      }

      return tx.camporee_members.update({
        where: { camporee_member_id: camporeeMemberId },
        data: {
          status: 'rejected',
          rejected_by: rejectedBy,
          rejection_reason: rejectionReason ?? null,
          modified_at: new Date(),
        },
      });
    });
  }

  // ============================================================
  // SCOPED CLUB ENROLLMENT — UNION
  // ============================================================

  /**
   * Approve a pending club enrollment scoped to a specific union camporee.
   */
  async approveUnionClubEnrollment(
    unionCamporeeId: number,
    camporeeClubId: number,
    approvedBy: string,
  ) {
    // Wrap check + update in a transaction to prevent a concurrent approval/rejection
    // from slipping between the findFirst and the update (check-then-act race condition).
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.camporee_clubs.findFirst({
        where: {
          camporee_club_id: camporeeClubId,
          union_camporee_id: unionCamporeeId,
          status: 'pending_approval',
        },
      });
      if (!record) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_CLUB_ENROLLMENT_PENDING_NOT_FOUND,
        );
      }
      await this.assertClubRegistrationOpenForPendingClub(record, tx);

      return tx.camporee_clubs.update({
        where: { camporee_club_id: camporeeClubId },
        data: {
          status: 'approved',
          approved_by: approvedBy,
          modified_at: new Date(),
        },
      });
    });
  }

  /**
   * Reject a pending club enrollment scoped to a specific union camporee.
   */
  async rejectUnionClubEnrollment(
    unionCamporeeId: number,
    camporeeClubId: number,
    rejectedBy: string,
    rejectionReason?: string,
  ) {
    // Wrap check + update in a transaction to prevent a concurrent approval/rejection
    // from slipping between the findFirst and the update (check-then-act race condition).
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.camporee_clubs.findFirst({
        where: {
          camporee_club_id: camporeeClubId,
          union_camporee_id: unionCamporeeId,
          status: 'pending_approval',
        },
      });
      if (!record) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_CLUB_ENROLLMENT_PENDING_NOT_FOUND,
        );
      }
      return tx.camporee_clubs.update({
        where: { camporee_club_id: camporeeClubId },
        data: {
          status: 'rejected',
          rejected_by: rejectedBy,
          rejection_reason: rejectionReason ?? null,
          modified_at: new Date(),
        },
      });
    });
  }

  // ============================================================
  // SCOPED MEMBER ENROLLMENT — UNION
  // ============================================================

  /**
   * Approve a pending member enrollment scoped to a specific union camporee.
   */
  async approveUnionMemberEnrollment(
    unionCamporeeId: number,
    camporeeMemberId: number,
    approvedBy: string,
  ) {
    // Wrap check + update in a transaction to prevent a concurrent approval/rejection
    // from slipping between the findFirst and the update (check-then-act race condition).
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.camporee_members.findFirst({
        where: {
          camporee_member_id: camporeeMemberId,
          union_camporee_id: unionCamporeeId,
          status: 'pending_approval',
        },
      });
      if (!record) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_MEMBER_ENROLLMENT_PENDING_NOT_FOUND,
        );
      }
      return tx.camporee_members.update({
        where: { camporee_member_id: camporeeMemberId },
        data: {
          status: 'approved',
          approved_by: approvedBy,
          modified_at: new Date(),
        },
      });
    });
  }

  /**
   * Reject a pending member enrollment scoped to a specific union camporee.
   */
  async rejectUnionMemberEnrollment(
    unionCamporeeId: number,
    camporeeMemberId: number,
    rejectedBy: string,
    rejectionReason?: string,
  ) {
    // Wrap check + update in a transaction to prevent a concurrent approval/rejection
    // from slipping between the findFirst and the update (check-then-act race condition).
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.camporee_members.findFirst({
        where: {
          camporee_member_id: camporeeMemberId,
          union_camporee_id: unionCamporeeId,
          status: 'pending_approval',
        },
      });
      if (!record) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_MEMBER_ENROLLMENT_PENDING_NOT_FOUND,
        );
      }
      return tx.camporee_members.update({
        where: { camporee_member_id: camporeeMemberId },
        data: {
          status: 'rejected',
          rejected_by: rejectedBy,
          rejection_reason: rejectionReason ?? null,
          modified_at: new Date(),
        },
      });
    });
  }

  // ============================================================
  // SCOPED CLUB ENROLLMENT — LOCAL
  // ============================================================

  /**
   * Approve a pending club enrollment scoped to a specific local camporee.
   */
  async approveLocalClubEnrollment(
    camporeeId: number,
    camporeeClubId: number,
    approvedBy: string,
  ) {
    // Wrap check + update in a transaction to prevent a concurrent approval/rejection
    // from slipping between the findFirst and the update (check-then-act race condition).
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.camporee_clubs.findFirst({
        where: {
          camporee_club_id: camporeeClubId,
          camporee_id: camporeeId,
          status: 'pending_approval',
        },
      });
      if (!record) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_CLUB_ENROLLMENT_PENDING_NOT_FOUND,
        );
      }
      await this.assertClubRegistrationOpenForPendingClub(record, tx);

      return tx.camporee_clubs.update({
        where: { camporee_club_id: camporeeClubId },
        data: {
          status: 'approved',
          approved_by: approvedBy,
          modified_at: new Date(),
        },
      });
    });
  }

  /**
   * Reject a pending club enrollment scoped to a specific local camporee.
   */
  async rejectLocalClubEnrollment(
    camporeeId: number,
    camporeeClubId: number,
    rejectedBy: string,
    rejectionReason?: string,
  ) {
    // Wrap check + update in a transaction to prevent a concurrent approval/rejection
    // from slipping between the findFirst and the update (check-then-act race condition).
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.camporee_clubs.findFirst({
        where: {
          camporee_club_id: camporeeClubId,
          camporee_id: camporeeId,
          status: 'pending_approval',
        },
      });
      if (!record) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_CLUB_ENROLLMENT_PENDING_NOT_FOUND,
        );
      }
      return tx.camporee_clubs.update({
        where: { camporee_club_id: camporeeClubId },
        data: {
          status: 'rejected',
          rejected_by: rejectedBy,
          rejection_reason: rejectionReason ?? null,
          modified_at: new Date(),
        },
      });
    });
  }

  // ============================================================
  // SCOPED MEMBER ENROLLMENT — LOCAL
  // ============================================================

  /**
   * Approve a pending member enrollment scoped to a specific local camporee.
   */
  async approveLocalMemberEnrollment(
    camporeeId: number,
    camporeeMemberId: number,
    approvedBy: string,
  ) {
    // Wrap check + update in a transaction to prevent a concurrent approval/rejection
    // from slipping between the findFirst and the update (check-then-act race condition).
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.camporee_members.findFirst({
        where: {
          camporee_member_id: camporeeMemberId,
          camporee_id: camporeeId,
          status: 'pending_approval',
        },
      });
      if (!record) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_MEMBER_ENROLLMENT_PENDING_NOT_FOUND,
        );
      }
      return tx.camporee_members.update({
        where: { camporee_member_id: camporeeMemberId },
        data: {
          status: 'approved',
          approved_by: approvedBy,
          modified_at: new Date(),
        },
      });
    });
  }

  /**
   * Reject a pending member enrollment scoped to a specific local camporee.
   */
  async rejectLocalMemberEnrollment(
    camporeeId: number,
    camporeeMemberId: number,
    rejectedBy: string,
    rejectionReason?: string,
  ) {
    // Wrap check + update in a transaction to prevent a concurrent approval/rejection
    // from slipping between the findFirst and the update (check-then-act race condition).
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.camporee_members.findFirst({
        where: {
          camporee_member_id: camporeeMemberId,
          camporee_id: camporeeId,
          status: 'pending_approval',
        },
      });
      if (!record) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_MEMBER_ENROLLMENT_PENDING_NOT_FOUND,
        );
      }
      return tx.camporee_members.update({
        where: { camporee_member_id: camporeeMemberId },
        data: {
          status: 'rejected',
          rejected_by: rejectedBy,
          rejection_reason: rejectionReason ?? null,
          modified_at: new Date(),
        },
      });
    });
  }

  // ============================================================
  // PAYMENT
  // ============================================================

  /**
   * Approve a pending payment.
   * NOTE: camporee_payment_id is a UUID string.
   */
  async approvePayment(camporeePaymentId: string, approvedBy: string) {
    // Wrap check + update in a transaction to prevent a concurrent approval/rejection
    // from slipping between the findFirst and the update (check-then-act race condition).
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.camporee_payments.findFirst({
        where: {
          camporee_payment_id: camporeePaymentId,
          status: 'pending_approval',
        },
      });

      if (!record) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_PAYMENT_PENDING_NOT_FOUND,
        );
      }

      return tx.camporee_payments.update({
        where: { camporee_payment_id: camporeePaymentId },
        data: {
          status: 'approved',
          approved_by: approvedBy,
        },
      });
    });
  }

  /**
   * Reject a pending payment.
   * NOTE: camporee_payment_id is a UUID string.
   */
  async rejectPayment(
    camporeePaymentId: string,
    rejectedBy: string,
    rejectionReason?: string,
  ) {
    // Wrap check + update in a transaction to prevent a concurrent approval/rejection
    // from slipping between the findFirst and the update (check-then-act race condition).
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.camporee_payments.findFirst({
        where: {
          camporee_payment_id: camporeePaymentId,
          status: 'pending_approval',
        },
      });

      if (!record) {
        throw new AppNotFoundException(
          ErrorCode.CAMPOREE_PAYMENT_PENDING_NOT_FOUND,
        );
      }

      return tx.camporee_payments.update({
        where: { camporee_payment_id: camporeePaymentId },
        data: {
          status: 'rejected',
          rejected_by: rejectedBy,
          rejection_reason: rejectionReason ?? null,
        },
      });
    });
  }
}
