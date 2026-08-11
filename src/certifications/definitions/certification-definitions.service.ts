import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AppBadRequestException,
  AppNotFoundException,
} from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { assertVersionMutable } from '../domain/certification-state-machine';
import {
  parseComponentInput,
  parseEligibilityRuleInput,
  type ComponentInput,
  type EligibilityRuleInput,
} from './certification-configuration.parsers';

type ModuleInput = {
  name: string;
  description?: string | null;
  sort_order?: number;
  sections: SectionInput[];
};

type SectionInput = {
  name: string;
  description?: string | null;
  instructions?: string | null;
  sort_order?: number;
  required?: boolean;
  components: ComponentInput[];
};

/**
 * Minimal transactional client surface used by this service. Matches both
 * PrismaService and the `tx` argument passed into `$transaction` callbacks.
 */
type PrismaTransactionClient = Omit<
  PrismaService,
  '$transaction' | '$connect' | '$disconnect' | '$on' | '$use' | '$extends'
>;

@Injectable()
export class CertificationDefinitionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================================
  // CERTIFICATION IDENTITY
  // ==========================================================================

  async createCertification(name: string, description?: string) {
    return this.prisma.$transaction(async (tx) => {
      const certification = await tx.certifications.create({
        data: {
          name,
          description: description ?? null,
          active: true,
        },
      });

      const existingVersion = await tx.certification_versions.findFirst({
        where: { certification_id: certification.certification_id },
      });

      const version =
        existingVersion ??
        (await tx.certification_versions.create({
          data: {
            certification_id: certification.certification_id,
            version_number: 1,
            status: 'DRAFT',
            title: name,
            description: description ?? null,
          },
        }));

      return { certification, version };
    });
  }

  // ==========================================================================
  // VERSION LIFECYCLE
  // ==========================================================================

  async createDraftVersion(certificationId: number) {
    await this.getCertificationOrThrow(certificationId);
    const nextVersionNumber = await this.getNextVersionNumber(certificationId);

    return this.prisma.certification_versions.create({
      data: {
        certification_id: certificationId,
        version_number: nextVersionNumber,
        status: 'DRAFT',
      },
    });
  }

  async cloneVersion(certificationId: number, versionId: number) {
    const source = await this.prisma.certification_versions.findFirst({
      where: {
        certification_version_id: versionId,
        certification_id: certificationId,
      },
      include: {
        certification_eligibility_rules: true,
        certification_modules: {
          include: {
            certification_sections: {
              include: { certification_requirement_components: true },
            },
          },
        },
      },
    });

    if (!source) {
      throw new AppNotFoundException(ErrorCode.CERT_NOT_FOUND);
    }

    if (source.status === 'DRAFT') {
      throw new AppBadRequestException(ErrorCode.CERT_VERSION_NOT_PUBLISHED);
    }

    return this.prisma.$transaction(async (tx) => {
      const nextVersionNumber = await this.getNextVersionNumber(
        certificationId,
        tx,
      );

      const newVersion = await tx.certification_versions.create({
        data: {
          certification_id: certificationId,
          version_number: nextVersionNumber,
          status: 'DRAFT',
          title: source.title,
          description: source.description,
          min_duration_months: source.min_duration_months,
          max_duration_months: source.max_duration_months,
        },
      });

      for (const rule of source.certification_eligibility_rules) {
        await tx.certification_eligibility_rules.create({
          data: {
            certification_version_id: newVersion.certification_version_id,
            rule_type: rule.rule_type,
            configuration: rule.configuration as object,
            class_id: rule.class_id,
            club_type_id: rule.club_type_id,
            role_id: rule.role_id,
            sort_order: rule.sort_order,
          },
        });
      }

      for (const module of source.certification_modules) {
        const newModule = await tx.certification_modules.create({
          data: {
            certification_id: certificationId,
            certification_version_id: newVersion.certification_version_id,
            name: module.name,
            description: module.description,
            sort_order: module.sort_order,
          },
        });

        for (const section of module.certification_sections) {
          const newSection = await tx.certification_sections.create({
            data: {
              module_id: newModule.module_id,
              name: section.name,
              description: section.description,
              instructions: section.instructions,
              sort_order: section.sort_order,
              required: section.required,
            },
          });

          for (const component of section.certification_requirement_components) {
            await tx.certification_requirement_components.create({
              data: {
                section_id: newSection.section_id,
                component_type: component.component_type,
                label: component.label,
                instructions: component.instructions,
                configuration: component.configuration as object,
                sort_order: component.sort_order,
                required: component.required,
                honor_id: component.honor_id,
                activity_type_id: component.activity_type_id,
              },
            });
          }
        }
      }

      return newVersion;
    });
  }

  async updateVersionMetadata(
    certificationId: number,
    versionId: number,
    dto: {
      title?: string;
      description?: string;
      min_duration_months?: number;
      max_duration_months?: number;
    },
  ) {
    const version = await this.getVersionOrThrow(certificationId, versionId);
    assertVersionMutable(version.status);

    return this.prisma.certification_versions.update({
      where: { certification_version_id: versionId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.min_duration_months !== undefined
          ? { min_duration_months: dto.min_duration_months }
          : {}),
        ...(dto.max_duration_months !== undefined
          ? { max_duration_months: dto.max_duration_months }
          : {}),
      },
    });
  }

  async retireVersion(certificationId: number, versionId: number) {
    const version = await this.getVersionOrThrow(certificationId, versionId);

    if (version.status !== 'PUBLISHED') {
      throw new AppBadRequestException(ErrorCode.CERT_VERSION_NOT_PUBLISHED);
    }

    return this.prisma.certification_versions.update({
      where: { certification_version_id: versionId },
      data: {
        status: 'RETIRED',
        retired_at: new Date(),
      },
    });
  }

  async publishVersion(
    certificationId: number,
    versionId: number,
    actorUserId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.certification_versions.findFirst({
        where: {
          certification_version_id: versionId,
          certification_id: certificationId,
        },
        include: {
          certification_eligibility_rules: true,
          certification_modules: {
            include: {
              certification_sections: {
                include: { certification_requirement_components: true },
              },
            },
          },
        },
      });

      if (!version) {
        throw new AppNotFoundException(ErrorCode.CERT_NOT_FOUND);
      }

      assertVersionMutable(version.status);
      this.assertPublishable(version);

      const now = new Date();

      const previousPublished = await tx.certification_versions.findFirst({
        where: {
          certification_id: certificationId,
          status: 'PUBLISHED',
        },
      });

      if (previousPublished) {
        await tx.certification_versions.update({
          where: {
            certification_version_id:
              previousPublished.certification_version_id,
          },
          data: { status: 'RETIRED', retired_at: now },
        });
      }

      return tx.certification_versions.update({
        where: { certification_version_id: versionId },
        data: {
          status: 'PUBLISHED',
          published_at: now,
          published_by_id: actorUserId,
        },
      });
    });
  }

  private assertPublishable(version: {
    certification_eligibility_rules: unknown[];
    certification_modules: Array<{
      module_id: number;
      certification_sections: Array<{
        section_id: number;
        certification_requirement_components: unknown[];
      }>;
    }>;
  }) {
    if (version.certification_eligibility_rules.length === 0) {
      throw new AppBadRequestException(ErrorCode.CERT_REQUIREMENT_INCOMPLETE, {
        reason: 'missing_eligibility_rules',
      });
    }

    if (version.certification_modules.length === 0) {
      throw new AppBadRequestException(ErrorCode.CERT_REQUIREMENT_INCOMPLETE, {
        reason: 'missing_modules',
      });
    }

    for (const module of version.certification_modules) {
      if (module.certification_sections.length === 0) {
        throw new AppBadRequestException(
          ErrorCode.CERT_REQUIREMENT_INCOMPLETE,
          { reason: 'module_without_sections', moduleId: module.module_id },
        );
      }

      for (const section of module.certification_sections) {
        if (section.certification_requirement_components.length === 0) {
          throw new AppBadRequestException(
            ErrorCode.CERT_REQUIREMENT_INCOMPLETE,
            {
              reason: 'section_without_components',
              sectionId: section.section_id,
            },
          );
        }
      }
    }
  }

  // ==========================================================================
  // ELIGIBILITY RULES (DRAFT only)
  // ==========================================================================

  async replaceEligibilityRules(
    certificationId: number,
    versionId: number,
    rules: EligibilityRuleInput[],
  ) {
    const version = await this.getVersionOrThrow(certificationId, versionId);
    assertVersionMutable(version.status);

    const parsedRules = rules.map((rule, index) =>
      parseEligibilityRuleInput(rule, index),
    );

    return this.prisma.$transaction(async (tx) => {
      await tx.certification_eligibility_rules.deleteMany({
        where: { certification_version_id: versionId },
      });

      for (const rule of parsedRules) {
        await tx.certification_eligibility_rules.create({
          data: {
            certification_version_id: versionId,
            rule_type: rule.rule_type,
            configuration: rule.configuration as Prisma.InputJsonValue,
            class_id: rule.class_id,
            club_type_id: rule.club_type_id,
            role_id: rule.role_id,
            sort_order: rule.sort_order,
          },
        });
      }

      return tx.certification_eligibility_rules.findMany({
        where: { certification_version_id: versionId },
        orderBy: { sort_order: 'asc' },
      });
    });
  }

  // ==========================================================================
  // TREE (modules → sections → components) — DRAFT only
  // ==========================================================================

  async replaceModulesTree(
    certificationId: number,
    versionId: number,
    modules: ModuleInput[],
  ) {
    const version = await this.getVersionOrThrow(certificationId, versionId);
    assertVersionMutable(version.status);

    const parsedModules = modules.map((module, moduleIndex) => ({
      name: module.name,
      description: module.description ?? null,
      sort_order: module.sort_order ?? moduleIndex,
      sections: module.sections.map((section, sectionIndex) => ({
        name: section.name,
        description: section.description ?? null,
        instructions: section.instructions ?? null,
        sort_order: section.sort_order ?? sectionIndex,
        required: section.required ?? true,
        components: section.components.map((component, componentIndex) =>
          parseComponentInput(component, componentIndex),
        ),
      })),
    }));

    return this.prisma.$transaction(async (tx) => {
      const existingModules = await tx.certification_modules.findMany({
        where: { certification_version_id: versionId },
        select: { module_id: true },
      });
      const moduleIds = existingModules.map((m) => m.module_id);

      if (moduleIds.length > 0) {
        await tx.certification_sections.deleteMany({
          where: { module_id: { in: moduleIds } },
        });
        await tx.certification_modules.deleteMany({
          where: { certification_version_id: versionId },
        });
      }

      for (const module of parsedModules) {
        const newModule = await tx.certification_modules.create({
          data: {
            certification_id: certificationId,
            certification_version_id: versionId,
            name: module.name,
            description: module.description,
            sort_order: module.sort_order,
          },
        });

        for (const section of module.sections) {
          const newSection = await tx.certification_sections.create({
            data: {
              module_id: newModule.module_id,
              name: section.name,
              description: section.description,
              instructions: section.instructions,
              sort_order: section.sort_order,
              required: section.required,
            },
          });

          for (const component of section.components) {
            await tx.certification_requirement_components.create({
              data: {
                section_id: newSection.section_id,
                component_type: component.component_type,
                label: component.label,
                instructions: component.instructions,
                configuration: component.configuration as Prisma.InputJsonValue,
                sort_order: component.sort_order,
                required: component.required,
                honor_id: component.honor_id,
                activity_type_id: component.activity_type_id,
              },
            });
          }
        }
      }

      return tx.certification_modules.findMany({
        where: { certification_version_id: versionId },
        include: {
          certification_sections: {
            include: { certification_requirement_components: true },
          },
        },
        orderBy: { sort_order: 'asc' },
      });
    });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private async getCertificationOrThrow(certificationId: number) {
    const certification = await this.prisma.certifications.findUnique({
      where: { certification_id: certificationId },
    });
    if (!certification) {
      throw new AppNotFoundException(ErrorCode.CERT_NOT_FOUND);
    }
    return certification;
  }

  private async getVersionOrThrow(certificationId: number, versionId: number) {
    const version = await this.prisma.certification_versions.findFirst({
      where: {
        certification_version_id: versionId,
        certification_id: certificationId,
      },
    });
    if (!version) {
      throw new AppNotFoundException(ErrorCode.CERT_NOT_FOUND);
    }
    return version;
  }

  private async getNextVersionNumber(
    certificationId: number,
    client: Pick<PrismaTransactionClient, 'certification_versions'> = this
      .prisma,
  ): Promise<number> {
    const latest = await client.certification_versions.findFirst({
      where: { certification_id: certificationId },
      orderBy: { version_number: 'desc' },
    });
    return (latest?.version_number ?? 0) + 1;
  }
}
