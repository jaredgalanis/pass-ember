import { moduleFor, test } from 'ember-qunit';

moduleFor('route:thanks', 'Unit | Route | thanks', {
  // Specify the other units that are required for this test.
  needs: ['service:toast', 'service:error-handler']
});

test('it exists', function (assert) {
  let route = this.subject();
  assert.ok(route);
});
