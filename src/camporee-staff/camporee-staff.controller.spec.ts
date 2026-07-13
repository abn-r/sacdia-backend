import 'reflect-metadata';
import { PERMISSIONS_KEY } from '../common/decorators';
import { CamporeeStaffController } from './camporee-staff.controller';

describe('CamporeeStaffController permissions', () => {
  it('requires update permission for local staff candidates', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        CamporeeStaffController.prototype.listLocalStaffCandidates,
      ),
    ).toEqual({ permissions: ['camporee_events:update'], mode: 'all' });
  });

  it('requires update permission for union staff candidates', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        CamporeeStaffController.prototype.listUnionStaffCandidates,
      ),
    ).toEqual({ permissions: ['camporee_events:update'], mode: 'all' });
  });
});
