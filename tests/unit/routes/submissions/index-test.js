import { moduleFor, test } from 'ember-qunit';

moduleFor('route:submissions/index', 'Unit | Route | submissions/index', {
  // Specify the other units that are required for this test.
  needs: ['service:currentUser', 'service:toast', 'service:error-handler']
});

test('it exists', function (assert) {
  let route = this.subject();
  assert.ok(route);
});
