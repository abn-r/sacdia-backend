import { activityVisibleToViewer } from './activity-audience';

describe('activityVisibleToViewer', () => {
  it('shows every section activity to a board member', () => {
    expect(
      activityVisibleToViewer(
        { audience: 'board' },
        { isBoard: true, classId: null },
      ),
    ).toBe(true);
    expect(
      activityVisibleToViewer(
        { audience: 'classes', classes: [4] },
        { isBoard: true, classId: 9 },
      ),
    ).toBe(true);
  });

  it('hides board activities from a regular member', () => {
    expect(
      activityVisibleToViewer(
        { audience: 'board' },
        { isBoard: false, classId: 6 },
      ),
    ).toBe(false);
  });

  it('shows a class activity only when the member class is included', () => {
    const activity = { audience: 'classes', classes: [6, 7] };
    expect(
      activityVisibleToViewer(activity, { isBoard: false, classId: 6 }),
    ).toBe(true);
    expect(
      activityVisibleToViewer(activity, { isBoard: false, classId: 3 }),
    ).toBe(false);
    expect(
      activityVisibleToViewer(activity, { isBoard: false, classId: null }),
    ).toBe(false);
  });

  it('keeps section-wide activities visible to every member', () => {
    expect(
      activityVisibleToViewer(
        { audience: 'all' },
        { isBoard: false, classId: null },
      ),
    ).toBe(true);
  });
});
