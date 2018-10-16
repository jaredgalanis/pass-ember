import WorkflowComponent from './workflow-component';
import { inject as service } from '@ember/service';
import ENV from 'pass-ember/config/environment';

function resolve(submission) {
  const base = 'https://doi.org/';

  let doi = submission.get('doi');
  if (!doi) {
    return Promise.reject(new Error('No DOI present'));
  }
  doi = doi.replace(/https?:\/\/(dx\.)?doi\.org\//gi, '');

  return fetch(base + encodeURI(doi), {
    redirect: 'follow',
    headers: {
      Accept: 'application/vnd.citationstyles.csl+json'
    }
  })
    .then((response) => {
      if (response.status >= 200 && response.status < 300) {
        return response;
      }
      const error = new Error(response.statusText);
      error.response = response;
      throw error;
    })
    .then(response => response.json());
}

export default WorkflowComponent.extend({
  store: service('store'),
  base: Ember.computed(() => ENV.fedora.elasticsearch),
  ajax: Ember.inject.service(),
  doiJournal: false,
  validDOI: 'form-control',
  isValidDOI: false,
  validTitle: 'form-control',
  toast: service('toast'),
  errorHandler: service('error-handler'),
  showProxyWindow: false,
  emailLookup: '',
  currentUser: service('current-user'),
  nextDisabled: Ember.computed(
    'model.publication.journal',
    'model.publication.title',
    'model.newSubmission.hasNewProxy',
    'model.newSubmission.preparer',
    function () {
      return (
        this.get('model.publication.journal') &&
        this.get('model.publication.title') &&
        // if there's a proxy, there must also be either
        // a submitter or (submitterName and submitterEmail)
        (
          (
            this.get('model.newSubmission.hasNewProxy') &&
            (
              this.get('model.newSubmission.submitter.id') ||
              (this.get('submitterName') && this.get('submitterEmail'))
            )
          ) ||
          !this.get('model.newSubmission.hasNewProxy'))
      );
    }
  ),
  didRender() {
    this._super(...arguments);
    this.send('validateDOI');

    // if there's no proxy, reset all proxy-popup-related fields
    if (!this.get('model.newSubmission.hasNewProxy') && !this.get('hasProxy')) {
      this.set('submitterEmail', '');
      this.set('submitterName', '');
      this.set('model.newSubmission.submitter', null);
      this.get('model.newSubmission.preparers').clear();
      this.set('emailLookup', '');
    }
  },
  didInsertElement() {
    this._super(...arguments);
    this.send('lookupDOI');
  },
  _headers() {
    return {
      'Content-Type': 'application/json; charset=utf-8'
    };
  },
  actions: {
    searchUsers() {
      const email = this.get('emailLookup');
      if (email) {
        return this.get('ajax').post(this.get('base'), {
          data: {
            size: 500,
            from: 0,
            query: {
              bool: { must: { term: { email } }, filter: { term: { '@type': 'User' } } }
            },
            _source: { excludes: '*_suggest' }
          },
          headers: this._headers(),
          xhrFields: { withCredentials: true }
        }).then((res) => {
          if (res.hits.hits.length > 0) {
            const userId = res.hits.hits[0]._source['@id'];
            this.get('store').findRecord('user', userId).then((u) => {
              this.set('model.newSubmission.submitter', u);
              const displayName = this.get('model.newSubmission.submitter.displayName');
              toastr.success(`Submitter updated to ${displayName}.`);
            });
          } else {
            toastr.error('Submitter not found.');
          }
        });
      }
    },
    toggleProxy(choice) {
      this.set('hasProxy', choice);
    },
    validateNext() {
      const title = this.get('model.publication.title');
      const journal = this.get('model.publication.journal');

      // booleans
      const newProxy = this.get('model.newSubmission.hasNewProxy');
      const currentUserIsNotSubmitter = this.get('model.newSubmission.submitter.id') !== this.get('currentUser.user.id');
      const proxySubmitterInfoExists = this.get('submitterEmail') && this.get('submitterName');
      const userIsNotPreparer = !this.get('model.newSubmission.preparers').map(x => x.get('id')).includes(this.get('currentUser.user.id'));
      const submitterExists = this.get('model.newSubmission.submitter.id');
      const proxySubmitterExists = submitterExists && currentUserIsNotSubmitter;


      // A journal and title must be present
      if (!journal.get('id')) {
        toastr.warning('The journal must not be left blank');
        $('.ember-power-select-trigger').css('border-color', '#f86c6b');
      } else {
        $('.ember-power-select-trigger').css('border-color', '#4dbd74');
      }

      if (!title) {
        toastr.warning('The title must not be left blank');
        this.set('validTitle', 'form-control is-invalid');
      } else {
        this.set('validTitle', 'form-control is-valid');
      }

      // if either is missing, end function early.
      if (!journal.get('id') || !title) {
        return;
      }

      // If there's no submitter or submitter info and the submission is a new proxy submission:
      if (!(submitterExists || proxySubmitterInfoExists) && newProxy) {
        toastr.warning('You have indicated that you are submitting on behalf of someone else, but have not chosen that someone.');
        return;
      }
      if (newProxy) {
        // If the submitter is not the current user
        // OR there is information to be turned into a submitter later
        // AND the current user is not already a preparer,
        if ((proxySubmitterExists || proxySubmitterInfoExists) && userIsNotPreparer) {
          // THEN add the current user to the preparers list
          this.get('model.newSubmission.preparers').addObject(this.get('currentUser.user'));
        }
      } else if (!this.get('hasProxy')) {
        // Otherwise, if it is not a proxy submission, make the current user the submitter.
        this.set('model.newSubmission.submitter', this.get('currentUser.user'));
      }
      // If there's no title in the information grabbed via DOI, use the title given by the user.
      if (!this.get('doiInfo.title')) this.set('doiInfo.title', this.get('model.publication.title'));
      // Move to the next form.
      this.send('next');
    },
    next() {
      this.sendAction('next');
    },
    validateDOI() {
      // ref: https://www.crossref.org/blog/dois-and-matching-regular-expressions/
      const doi = this.get('model.publication.doi');
      const newDOIRegExp = /^(https?:\/\/(dx\.)?doi\.org\/)?10.\d{4,9}\/[-._;()/:A-Z0-9]+$/i;
      const ancientDOIRegExp = /^(https?:\/\/(dx\.)?doi\.org\/)?10.1002\/[^\s]+$/i;
      // 0 = no value
      if (doi == null || !doi) {
        this.set('validDOI', 'form-control');
        this.set('isValidDOI', false);
      } else if (newDOIRegExp.test(doi) === true || ancientDOIRegExp.test(doi) === true) {
        // 1 - Accepted
        this.set('validDOI', 'form-control is-valid');
        $('.ember-power-select-trigger').css('border-color', '#4dbd74');
        this.set('validTitle', 'form-control is-valid');
        this.set('model.newSubmission.metadata', '[]');
        this.set('isValidDOI', true);
        toastr.success("We've pre-populated information from the DOI provided!");
      } else {
        this.set('validDOI', 'form-control is-invalid');
        this.set('isValidDOI', false);
      }
    },
    validateTitle() {
      const title = this.get('model.publication.title');
      if (title) { // if not null or empty, then valid
        this.set('validTitle', 'form-control is-valid');
      } else {
        this.set('validTitle', 'form-control is-invalid');
      }
    },
    /** looks up the DIO and returns title and journal if avaiable */
    lookupDOI() {
      if (this.get('model.publication.doi')) {
        this.set('model.publication.doi', this.get('model.publication.doi').trim());
        this.set('model.publication.doi', this.get('model.publication.doi').replace(/doi:/gi, ''));
        this.set('model.publication.doi', this.get('model.publication.doi').replace(/https?:\/\/(dx\.)?doi\.org\//gi, ''));
      }
      const publication = this.get('model.publication');
      if (publication) {
        this.send('validateDOI');
        this.set('doiJournal', false);
        resolve(publication).then(async (doiInfo) => {
          if (doiInfo.isDestroyed) {
            return;
          }
          const nlmtaDump = await this.getNlmtaFromIssn(doiInfo);
          if (nlmtaDump) {
            doiInfo.nlmta = nlmtaDump.nlmta;
            doiInfo['issn-map'] = nlmtaDump.map;
          }
          doiInfo['journal-title'] = doiInfo['container-title'];
          this.set('doiInfo', doiInfo);
          publication.set('title', doiInfo.title);
          publication.set('submittedDate', doiInfo.deposited);
          publication.set('creationDate', doiInfo.created);
          publication.set('issue', doiInfo.issue);
          publication.set('volume', doiInfo.volume);
          publication.set('abstract', doiInfo.abstract);

          const desiredName = doiInfo['container-title'].trim();
          const desiredIssn = Array.isArray(doiInfo.ISSN) // eslint-disable-line
            ? doiInfo['ISSN'][0] // eslint-disable-line
            : doiInfo.ISSN
              ? doiInfo.ISSN
              : '';

          let query = {
            bool: {
              should: [{ match: { journalName: desiredName } }]
            }
          };
          if (desiredIssn) {
            query.bool.must = { term: { issns: desiredIssn } };
          }
          // Must match ISSN, optionally match journalName
          // If journal is found, set it to the publication's journal.
          // If journal is not found, make a journal based off the provided info and
          // set it to the publication's journal.
          this.get('store').query('journal', { query }).then((journals) => {
            let journal = journals.get('length') > 0 ? journals.objectAt(0) : false;
            if (!journal) {
              const newJournal = this.get('store').createRecord('journal', {
                journalName: doiInfo['container-title'].trim(),
                issns: doiInfo.ISSN,
                nlmta: doiInfo.nmlta
              });
              newJournal.save().then(j => publication.set('journal', j));
            } else {
              publication.set('journal', journal);
            }
          });
        }); // end resolve(publication).then()
      } // end if (publication)
    },

    /** Sets the selected journal for the current publication.
     * @param journal {DS.Model} The journal
     */
    async selectJournal(journal) {
      let doiInfo = this.get('doiInfo');
      doiInfo = { 'journal-title': journal.get('journalName'), ISSN: journal.get('issns') };

      const nlmtaDump = await this.getNlmtaFromIssn(doiInfo);
      if (nlmtaDump) {
        doiInfo.nlmta = nlmtaDump.nlmta;
        doiInfo['issn-map'] = nlmtaDump.map;
      }
      this.set('doiInfo', doiInfo);

      const publication = this.get('model.publication');
      publication.set('journal', journal);
      $('.ember-power-select-trigger').css('border-color', '#4dbd74');
    }
  },

  /**
   * Use various services to fetch NLMTA and pub-type for given ISSNs found
   * in the DOI data. This info will be merged in with the DOI data.
   *
   *  {
   *    ... // other DOI data
   *    "issn-map": {
   *      "nlmta": "",
   *      "map": {
   *        "<ISSN-1>": {
   *          "pub-type": [""]
   *        }
   *      }
   *    }
   *  }
   */
  async getNlmtaFromIssn(doiInfo) {
    const issnMap = {
      nlmta: undefined,
      map: {}
    };

    // DOI should give ISSN as array or single string (?)
    const issn = Array.isArray(doiInfo.ISSN) ? doiInfo.ISSN[0] : doiInfo.ISSN;

    // Map of NLMIDs to objects
    // Example: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=nlmcatalog&term=0006-2952[issn]
    const nlmidMap = await this.getNLMID(issn);
    if (!nlmidMap || nlmidMap.length === 0) {
      return;
    }
    // Example: https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=nlmcatalog&retmode=json&rettype=abstract&id=101032
    const idmap = await this.getNLMTA(nlmidMap);
    nlmidMap.forEach((id) => {
      const data = idmap[id];
      if (!idmap) {
        return;
      }
      issnMap.nlmta = data.medlineta;
      data.issnlist
        .filter(item => item.issntype !== 'Linking')
        .forEach((item) => {
          issnMap.map[item.issn] = { 'pub-type': [item.issntype] };
        });
    });

    return issnMap;
  },
  /**
   * TODO What happens if 'idlist' contains more than one ID?
   * @param issn {string}
   */
  getNLMID(issn) {
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=nlmcatalog&term=${issn}[issn]&retmode=json`;
    return fetch(url)
      .then(resp => resp.json().then(data => data.esearchresult.idlist))
      .catch((e) => {
        console.log('NLMTA lookup failed.', e);
      });
  },
  getNLMTA(nlmid) {
    let idquery = nlmid;
    if (Array.isArray(nlmid)) idquery = nlmid.join(',');
    const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=nlmcatalog&retmode=json&rettype=abstract&id=${idquery}`;
    return fetch(url).then(resp => resp.json().then(data => data.result)).catch((e) => {
      console.log('NLMTA lookup failed.', e);
    });
  }
});
