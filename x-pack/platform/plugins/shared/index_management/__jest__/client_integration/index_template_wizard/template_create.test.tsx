/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import { act } from 'react-dom/test-utils';

import { API_BASE_PATH, LOOKUP_INDEX_MODE } from '../../../common/constants';
import { setupEnvironment } from '../helpers';

import {
  TEMPLATE_NAME,
  SETTINGS,
  ALIASES,
  INDEX_PATTERNS as DEFAULT_INDEX_PATTERNS,
} from './constants';
import { setup } from './template_create.helpers';
import { TemplateFormTestBed } from './template_form.helpers';

jest.mock('@kbn/code-editor', () => {
  const original = jest.requireActual('@kbn/code-editor');
  return {
    ...original,
    // Mocking CodeEditor, which uses React Monaco under the hood
    CodeEditor: (props: any) => (
      <input
        data-test-subj={props['data-test-subj'] || 'mockCodeEditor'}
        data-currentvalue={props.value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          props.onChange(e.currentTarget.getAttribute('data-currentvalue'));
        }}
      />
    ),
  };
});

jest.mock('@elastic/eui', () => {
  const original = jest.requireActual('@elastic/eui');

  return {
    ...original,
    // Mocking EuiComboBox, as it utilizes "react-virtualized" for rendering search suggestions,
    // which does not produce a valid component wrapper
    EuiComboBox: (props: any) => (
      <input
        data-test-subj="mockComboBox"
        onChange={(syntheticEvent: any) => {
          props.onChange([syntheticEvent['0']]);
        }}
      />
    ),
    EuiSuperSelect: (props: any) => (
      <input
        data-test-subj={props['data-test-subj'] || 'mockSuperSelect'}
        value={props.valueOfSelected}
        onChange={(e) => {
          props.onChange(e.target.value);
        }}
      />
    ),
  };
});

const TEXT_MAPPING_FIELD = {
  name: 'text_datatype',
  type: 'text',
};

const BOOLEAN_MAPPING_FIELD = {
  name: 'boolean_datatype',
  type: 'boolean',
};

const KEYWORD_MAPPING_FIELD = {
  name: 'keyword_datatype',
  type: 'keyword',
};

const componentTemplate1 = {
  name: 'test_component_template_1',
  hasMappings: true,
  hasAliases: false,
  hasSettings: false,
  usedBy: [],
  isManaged: false,
};

const componentTemplate2 = {
  name: 'test_component_template_2',
  hasMappings: false,
  hasAliases: false,
  hasSettings: true,
  usedBy: ['test_index_template_1'],
  isManaged: false,
};

const componentTemplates = [componentTemplate1, componentTemplate2];

describe('<TemplateCreate />', () => {
  let testBed: TemplateFormTestBed;

  const { httpSetup, httpRequestsMockHelpers } = setupEnvironment();

  beforeAll(() => {
    jest.useFakeTimers({ legacyFakeTimers: true });

    httpRequestsMockHelpers.setLoadComponentTemplatesResponse(componentTemplates);
    httpRequestsMockHelpers.setLoadNodesPluginsResponse([]);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe('composable index template', () => {
    beforeEach(async () => {
      await act(async () => {
        testBed = await setup(httpSetup);
      });
    });

    test('should set the correct page title', () => {
      const { exists, find } = testBed;

      expect(exists('pageTitle')).toBe(true);
      expect(find('pageTitle').text()).toEqual('Create template');
    });

    test('renders no deprecation warning', async () => {
      const { exists } = testBed;
      expect(exists('legacyIndexTemplateDeprecationWarning')).toBe(false);
    });

    test('should not let the user go to the next step with invalid fields', async () => {
      const { find, actions, component } = testBed;

      expect(find('nextButton').props().disabled).toEqual(false);

      await act(async () => {
        actions.clickNextButton();
        jest.advanceTimersByTime(0);
      });
      component.update();

      expect(find('nextButton').props().disabled).toEqual(true);
    });
  });

  describe('legacy index template', () => {
    beforeEach(async () => {
      await act(async () => {
        testBed = await setup(httpSetup, true);
      });
    });

    test('should set the correct page title', () => {
      const { exists, find } = testBed;

      expect(exists('pageTitle')).toBe(true);
      expect(find('pageTitle').text()).toEqual('Create legacy template');
    });

    test('renders deprecation warning', async () => {
      const { exists } = testBed;
      expect(exists('legacyIndexTemplateDeprecationWarning')).toBe(true);
    });
  });

  describe('form validation', () => {
    beforeEach(async () => {
      await act(async () => {
        testBed = await setup(httpSetup);
      });
      testBed.component.update();
    });

    describe('component templates (step 2)', () => {
      beforeEach(async () => {
        const { actions } = testBed;
        await actions.completeStepOne({ name: TEMPLATE_NAME, indexPatterns: ['index1'] });
        jest.advanceTimersByTime(0);
      });

      it('should set the correct page title', async () => {
        const { exists, find } = testBed;

        expect(exists('stepComponents')).toBe(true);
        expect(find('stepTitle').text()).toEqual('Component templates (optional)');
      });

      it(`doesn't render the deprecated legacy index template warning`, () => {
        const { exists } = testBed;
        expect(exists('legacyIndexTemplateDeprecationWarning')).toBe(false);
      });

      it('should list the available component templates', () => {
        const {
          actions: {
            componentTemplates: { getComponentTemplatesInList },
          },
        } = testBed;
        const componentsFound = getComponentTemplatesInList();
        expect(componentsFound).toEqual(componentTemplates.map((c) => c.name));
      });

      it('should allow to search for a component', async () => {
        const {
          component,
          form: { setInputValue },
          actions: {
            componentTemplates: { getComponentTemplatesInList },
          },
        } = testBed;

        await act(async () => {
          setInputValue('componentTemplateSearchBox', 'template_2');
        });
        component.update();

        const componentsFound = getComponentTemplatesInList();
        expect(componentsFound).toEqual(['test_component_template_2']);
      });

      it('should allow to filter component by Index settings, mappings and aliases', async () => {
        const {
          find,
          exists,
          actions: {
            componentTemplates: { showFilters, selectFilter, getComponentTemplatesInList },
          },
        } = testBed;

        showFilters();

        const filtersList = find('filterList.filterItem').map((wrapper) => wrapper.text());
        expect(filtersList[0]).toContain('Index settings');
        expect(filtersList[1]).toContain('Mappings');
        expect(filtersList[2]).toContain('Aliases');

        await selectFilter('settings');
        expect(getComponentTemplatesInList()).toEqual(['test_component_template_2']); // only this one has settings

        await selectFilter('mappings');
        expect(exists('componentTemplatesList')).toBe(false); // no component has **both** settings and mappings
        expect(exists('componentTemplates.emptySearchResult')).toBe(true);
        expect(find('componentTemplates.emptySearchResult').text()).toContain(
          'No components match your search'
        );

        await selectFilter('settings'); // unselect settings
        expect(getComponentTemplatesInList()).toEqual(['test_component_template_1']); // only this one has mappings

        await selectFilter('mappings'); // unselect mappings (back to start)
        expect(getComponentTemplatesInList()).toEqual([
          'test_component_template_1',
          'test_component_template_2',
        ]);

        await selectFilter('aliases');
        expect(exists('componentTemplatesList')).toBe(false); // no component has aliases defined.
      });

      it('should allow to select and unselect a component template', async () => {
        const {
          find,
          exists,
          actions: {
            componentTemplates: {
              selectComponentAt,
              unSelectComponentAt,
              getComponentTemplatesSelected,
            },
          },
        } = testBed;

        // Start with empty selection
        expect(exists('componentTemplatesSelection.emptyPrompt')).toBe(true);
        expect(find('componentTemplatesSelection.emptyPrompt').text()).toContain(
          'Add component template building blocks to this template.'
        );

        // Select first component in the list
        await selectComponentAt(0);
        expect(exists('componentTemplatesSelection.emptyPrompt')).toBe(false);
        expect(getComponentTemplatesSelected()).toEqual(['test_component_template_1']);

        // Unselect the component
        await unSelectComponentAt(0);
        expect(exists('componentTemplatesSelection.emptyPrompt')).toBe(true);
      });
    });

    describe('index settings (step 3)', () => {
      beforeEach(async () => {
        const { actions } = testBed;
        // Logistics
        await actions.completeStepOne({
          name: TEMPLATE_NAME,
          indexPatterns: ['index1'],
          indexMode: LOOKUP_INDEX_MODE,
        });
        // Component templates
        await actions.completeStepTwo();
      });

      it('should set the correct page title', async () => {
        const { exists, find } = testBed;

        expect(exists('stepSettings')).toBe(true);
        expect(find('stepTitle').text()).toEqual('Index settings (optional)');
      });

      it('should display a warning callout displaying the selected index mode', async () => {
        const { exists, find } = testBed;

        expect(exists('indexModeCallout')).toBe(true);
        expect(find('indexModeCallout').text()).toContain(
          'The index.mode setting has been set to Lookup within the Logistics step.'
        );
      });

      it('should not allow invalid json', async () => {
        const { form, actions } = testBed;

        await actions.completeStepThree('{ invalidJsonString ');

        expect(form.getErrorsMessages()).toContain('Invalid JSON format.');
      });

      it('should not allow setting number_of_shards to a value different from 1 for Lookup index mode', async () => {
        // The Lookup index mode was already selected in the first (Logistics) step
        const { form, actions } = testBed;

        await actions.completeStepThree('{ "index.number_of_shards": 2 }');

        expect(form.getErrorsMessages()).toContain(
          'Number of shards for lookup index mode can only be 1 or unset.'
        );
      });
    });

    describe('mappings (step 4)', () => {
      const navigateToMappingsStep = async () => {
        const { actions } = testBed;
        // Logistics
        await actions.completeStepOne({ name: TEMPLATE_NAME, indexPatterns: ['index1'] });
        // Component templates
        await actions.completeStepTwo();
        // Index settings
        await actions.completeStepThree('{}');
      };

      beforeEach(async () => {
        await navigateToMappingsStep();
      });

      it('should set the correct page title', () => {
        const { exists, find } = testBed;

        expect(exists('stepMappings')).toBe(true);
        expect(find('stepTitle').text()).toEqual('Mappings (optional)');
      });

      it('should allow the user to define document fields for a mapping', async () => {
        const { actions, find } = testBed;

        await actions.mappings.addField('field_1', 'text');
        await actions.mappings.addField('field_2', 'text');
        await actions.mappings.addField('field_3', 'text');

        expect(find('fieldsListItem').length).toBe(3);
      });

      it('should allow the user to remove a document field from a mapping', async () => {
        const { actions, find } = testBed;

        await actions.mappings.addField('field_1', 'text');
        await actions.mappings.addField('field_2', 'text');

        expect(find('fieldsListItem').length).toBe(2);

        actions.clickCancelCreateFieldButton();
        // Remove first field
        actions.deleteMappingsFieldAt(0);

        expect(find('fieldsListItem').length).toBe(1);
      });

      describe('plugin parameters', () => {
        const selectMappingsEditorTab = async (
          tab: 'fields' | 'runtimeFields' | 'templates' | 'advanced'
        ) => {
          const tabIndex = ['fields', 'runtimeFields', 'templates', 'advanced'].indexOf(tab);
          const tabElement = testBed.find('mappingsEditor.formTab').at(tabIndex);
          await act(async () => {
            tabElement.simulate('click');
          });
          testBed.component.update();
        };

        test('should not render the _size parameter if the mapper size plugin is not installed', async () => {
          const { exists } = testBed;
          // Navigate to the advanced configuration
          await selectMappingsEditorTab('advanced');

          expect(exists('mappingsEditor.advancedConfiguration.sizeEnabledToggle')).toBe(false);
        });

        test('should render the _size parameter if the mapper size plugin is installed', async () => {
          httpRequestsMockHelpers.setLoadNodesPluginsResponse(['mapper-size']);

          await act(async () => {
            testBed = await setup(httpSetup);
          });
          testBed.component.update();
          await navigateToMappingsStep();

          await selectMappingsEditorTab('advanced');

          expect(testBed.exists('mappingsEditor.advancedConfiguration.sizeEnabledToggle')).toBe(
            true
          );
        });
      });
    });

    describe('aliases (step 5)', () => {
      beforeEach(async () => {
        const { actions } = testBed;
        // Logistics
        await actions.completeStepOne({ name: TEMPLATE_NAME, indexPatterns: ['index1'] });
        // Component templates
        await actions.completeStepTwo();
        // Index settings
        await actions.completeStepThree('{}');
        // Mappings
        await actions.completeStepFour();
      });

      it('should set the correct page title', () => {
        const { exists, find } = testBed;

        expect(exists('stepAliases')).toBe(true);
        expect(find('stepTitle').text()).toEqual('Aliases (optional)');
      });

      it('should not allow invalid json', async () => {
        const { actions, form } = testBed;

        // Complete step 5 (aliases) with invalid json
        await actions.completeStepFive('{ invalidJsonString ');

        expect(form.getErrorsMessages()).toContain('Invalid JSON format.');
      });
    });
  });

  describe('logistics (step 1)', () => {
    beforeEach(async () => {
      await act(async () => {
        testBed = await setup(httpSetup);
      });
      testBed.component.update();
    });

    it('setting index pattern to logs-*-* should set the index mode to logsdb', async () => {
      const { component, actions } = testBed;
      // Logistics
      await actions.completeStepOne({ name: 'my_logs_template', indexPatterns: ['logs-*-*'] });
      // Component templates
      await actions.completeStepTwo();
      // Index settings
      await actions.completeStepThree('{}');
      // Mappings
      await actions.completeStepFour();
      // Aliases
      await actions.completeStepFive();

      await act(async () => {
        actions.clickNextButton();
      });
      component.update();

      expect(httpSetup.post).toHaveBeenLastCalledWith(
        `${API_BASE_PATH}/index_templates`,
        expect.objectContaining({
          body: JSON.stringify({
            name: 'my_logs_template',
            indexPatterns: ['logs-*-*'],
            indexMode: 'logsdb',
            allowAutoCreate: 'NO_OVERWRITE',
            dataStream: {},
            _kbnMeta: {
              type: 'default',
              hasDatastream: false,
              isLegacy: false,
            },
            template: {},
          }),
        })
      );
    });
  });

  describe('review (step 6)', () => {
    beforeEach(async () => {
      await act(async () => {
        testBed = await setup(httpSetup);
      });
      testBed.component.update();

      const { actions } = testBed;
      // Logistics
      await actions.completeStepOne({
        name: TEMPLATE_NAME,
        indexPatterns: DEFAULT_INDEX_PATTERNS,
      });
      // Component templates
      await actions.completeStepTwo('test_component_template_1');
      // Index settings
      await actions.completeStepThree(JSON.stringify(SETTINGS));
      // Mappings
      await actions.completeStepFour();
      // Aliases
      await actions.completeStepFive(JSON.stringify(ALIASES));
    });

    it('should set the correct step title', () => {
      const { find, exists } = testBed;
      expect(exists('stepSummary')).toBe(true);
      expect(find('stepTitle').text()).toEqual(`Review details for '${TEMPLATE_NAME}'`);
    });

    describe('tabs', () => {
      test('should have 3 tabs', () => {
        const { find } = testBed;

        expect(find('summaryTabContent').find('button.euiTab').length).toBe(3);
        expect(
          find('summaryTabContent')
            .find('button.euiTab')
            .map((t) => t.text())
        ).toEqual(['Summary', 'Preview', 'Request']);
      });

      test('should navigate to the preview and request tab', async () => {
        const { exists, actions } = testBed;

        expect(exists('summaryTab')).toBe(true);
        expect(exists('requestTab')).toBe(false);
        expect(exists('previewTab')).toBe(false);

        await actions.review.selectTab('preview');
        expect(exists('summaryTab')).toBe(false);
        expect(exists('previewTab')).toBe(true);

        await actions.review.selectTab('request');
        expect(exists('previewTab')).toBe(false);
        expect(exists('requestTab')).toBe(true);
      });
    });

    it('should render a warning message if a wildcard is used as an index pattern', async () => {
      await act(async () => {
        testBed = await setup(httpSetup);
      });
      testBed.component.update();

      const { actions } = testBed;
      // Logistics
      await actions.completeStepOne({
        name: TEMPLATE_NAME,
        indexPatterns: ['*'], // Set wildcard index pattern
      });
      // Component templates
      await actions.completeStepTwo();
      // Index settings
      await actions.completeStepThree(JSON.stringify({}));
      // Mappings
      await actions.completeStepFour();
      // Aliases
      await actions.completeStepFive(JSON.stringify({}));

      const { exists, find } = testBed;

      expect(exists('indexPatternsWarning')).toBe(true);
      expect(find('indexPatternsWarningDescription').text()).toEqual(
        'All new indices that you create will use this template. Edit index patterns.'
      );
    });
  });

  describe('form payload & api errors', () => {
    beforeEach(async () => {
      const MAPPING_FIELDS = [BOOLEAN_MAPPING_FIELD, TEXT_MAPPING_FIELD, KEYWORD_MAPPING_FIELD];

      await act(async () => {
        testBed = await setup(httpSetup);
      });
      testBed.component.update();

      const { actions } = testBed;
      // Logistics
      await actions.completeStepOne({
        name: TEMPLATE_NAME,
        indexPatterns: DEFAULT_INDEX_PATTERNS,
        allowAutoCreate: 'TRUE',
        indexMode: 'time_series',
      });
      // Component templates
      await actions.completeStepTwo('test_component_template_1');
      // Index settings
      await actions.completeStepThree(JSON.stringify(SETTINGS));
      // Mappings
      await actions.completeStepFour(MAPPING_FIELDS);
      // Aliases
      await actions.completeStepFive(JSON.stringify(ALIASES));
    });

    it('should send the correct payload', async () => {
      const { component, actions, find } = testBed;

      expect(find('stepTitle').text()).toEqual(`Review details for '${TEMPLATE_NAME}'`);

      await act(async () => {
        actions.clickNextButton();
      });
      component.update();

      expect(httpSetup.post).toHaveBeenLastCalledWith(
        `${API_BASE_PATH}/index_templates`,
        expect.objectContaining({
          body: JSON.stringify({
            name: TEMPLATE_NAME,
            indexPatterns: DEFAULT_INDEX_PATTERNS,
            indexMode: 'time_series',
            allowAutoCreate: 'TRUE',
            dataStream: {},
            _kbnMeta: {
              type: 'default',
              hasDatastream: false,
              isLegacy: false,
            },
            composedOf: ['test_component_template_1'],
            template: {
              settings: SETTINGS,
              mappings: {
                properties: {
                  [BOOLEAN_MAPPING_FIELD.name]: {
                    type: BOOLEAN_MAPPING_FIELD.type,
                  },
                  [TEXT_MAPPING_FIELD.name]: {
                    type: TEXT_MAPPING_FIELD.type,
                  },
                  [KEYWORD_MAPPING_FIELD.name]: {
                    type: KEYWORD_MAPPING_FIELD.type,
                  },
                },
              },
              aliases: ALIASES,
            },
          }),
        })
      );
    });

    it('should surface the API errors from the put HTTP request', async () => {
      const { component, actions, find, exists } = testBed;

      const error = {
        statusCode: 409,
        error: 'Conflict',
        message: `There is already a template with name '${TEMPLATE_NAME}'`,
      };

      httpRequestsMockHelpers.setCreateTemplateResponse(undefined, error);

      await act(async () => {
        actions.clickNextButton();
      });
      component.update();

      expect(exists('saveTemplateError')).toBe(true);
      expect(find('saveTemplateError').text()).toContain(error.message);
    });
  });

  describe.skip('DSL', () => {
    beforeEach(async () => {
      await act(async () => {
        testBed = await setup(httpSetup);
      });
      testBed.component.update();

      await testBed.actions.completeStepOne({
        name: TEMPLATE_NAME,
        indexPatterns: DEFAULT_INDEX_PATTERNS,
        lifecycle: {
          enabled: true,
          value: 1,
          unit: 'd',
        },
      });
    });

    test('should include DSL in summary when set in step 1', async () => {
      const { find, component } = testBed;

      await act(async () => {
        testBed.find('formWizardStep-5').simulate('click');
      });
      component.update();

      expect(find('lifecycleValue').text()).toContain('1 day');
    });

    test('preview data stream', async () => {
      const { actions } = testBed;

      await act(async () => {
        await actions.previewTemplate();
      });

      expect(httpSetup.post).toHaveBeenLastCalledWith(
        `${API_BASE_PATH}/index_templates/simulate`,
        expect.objectContaining({
          body: JSON.stringify({
            template: {
              lifecycle: {
                enabled: true,
                data_retention: '1d',
              },
            },
            index_patterns: DEFAULT_INDEX_PATTERNS,
            data_stream: {},
            allow_auto_create: 'NO_OVERWRITE',
          }),
        })
      );
    });
  });
});
