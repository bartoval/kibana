/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useEffect, useState } from 'react';
import { i18n } from '@kbn/i18n';
import { FormattedMessage } from '@kbn/i18n-react';
import {
  EuiExpression,
  EuiPopover,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFormRow,
  EuiComboBox,
  useEuiTheme,
} from '@elastic/eui';
import { css } from '@emotion/react';
import { builtInAggregationTypes } from '../constants';
import { AggregationType, FieldOption, ValidNormalizedTypes } from '../types';
import { IErrorObject } from '../../types';
import { ClosablePopoverTitle } from './components';
import { firstFieldOption } from '../index_controls';

interface OfFieldOption {
  label: string;
}
export interface OfExpressionProps {
  aggType: string;
  aggField?: string;
  errors: IErrorObject;
  onChangeSelectedAggField: (selectedAggField?: string) => void;
  fields: Record<string, any>;
  customAggTypesOptions?: {
    [key: string]: AggregationType;
  };
  popupPosition?:
    | 'upCenter'
    | 'upLeft'
    | 'upRight'
    | 'downCenter'
    | 'downLeft'
    | 'downRight'
    | 'leftCenter'
    | 'leftUp'
    | 'leftDown'
    | 'rightCenter'
    | 'rightUp'
    | 'rightDown';
  display?: 'fullWidth' | 'inline';
  helpText?: string | JSX.Element;
}

export const OfExpression = ({
  aggType,
  aggField,
  errors,
  onChangeSelectedAggField,
  fields,
  display = 'inline',
  customAggTypesOptions,
  popupPosition,
  helpText,
}: OfExpressionProps) => {
  const { euiTheme } = useEuiTheme();
  const [aggFieldPopoverOpen, setAggFieldPopoverOpen] = useState(false);
  const aggregationTypes = customAggTypesOptions ?? builtInAggregationTypes;

  const availableFieldOptions: OfFieldOption[] = fields.reduce(
    (esFieldOptions: OfFieldOption[], field: FieldOption) => {
      if (
        aggregationTypes[aggType].validNormalizedTypes.includes(
          field.normalizedType as ValidNormalizedTypes
        )
      ) {
        esFieldOptions.push({
          label: field.name,
        });
      }
      return esFieldOptions;
    },
    []
  );

  const aggFieldContainerCss = css`
    width: calc(${euiTheme.size.base} * 29);
  `;

  useEffect(() => {
    // if current field set doesn't contain selected field, clear selection
    if (
      aggField &&
      fields.length > 0 &&
      !fields.find((field: FieldOption) => field.name === aggField)
    ) {
      onChangeSelectedAggField(undefined);
    }
  }, [aggField, fields, onChangeSelectedAggField]);

  return (
    <EuiPopover
      id="aggFieldPopover"
      button={
        <EuiExpression
          description={i18n.translate(
            'xpack.triggersActionsUI.common.expressionItems.of.buttonLabel',
            {
              defaultMessage: 'of',
            }
          )}
          data-test-subj="ofExpressionPopover"
          display={display === 'inline' ? 'inline' : 'columns'}
          value={aggField || firstFieldOption.text}
          isActive={aggFieldPopoverOpen || !aggField}
          onClick={() => {
            setAggFieldPopoverOpen(true);
          }}
          isInvalid={!aggField}
        />
      }
      isOpen={aggFieldPopoverOpen}
      closePopover={() => {
        setAggFieldPopoverOpen(false);
      }}
      display={display === 'fullWidth' ? 'block' : 'inline-block'}
      anchorPosition={popupPosition ?? 'downRight'}
      zIndex={8000}
      repositionOnScroll
    >
      <div>
        <ClosablePopoverTitle onClose={() => setAggFieldPopoverOpen(false)}>
          <FormattedMessage
            id="xpack.triggersActionsUI.common.expressionItems.of.popoverTitle"
            defaultMessage="of"
          />
        </ClosablePopoverTitle>
        <EuiFlexGroup>
          <EuiFlexItem grow={false} className="actOf__aggFieldContainer" css={aggFieldContainerCss}>
            <EuiFormRow
              id="ofField"
              fullWidth
              isInvalid={Number(errors.aggField.length) > 0 && aggField !== undefined}
              error={errors.aggField as string[]}
              data-test-subj="availableFieldsOptionsFormRow"
              helpText={helpText}
            >
              <EuiComboBox
                fullWidth
                singleSelection={{ asPlainText: true }}
                data-test-subj="availableFieldsOptionsComboBox"
                isInvalid={Number(errors.aggField.length) > 0 && aggField !== undefined}
                placeholder={firstFieldOption.text}
                options={availableFieldOptions}
                noSuggestions={!availableFieldOptions.length}
                selectedOptions={aggField ? [{ label: aggField }] : []}
                onChange={(selectedOptions) => {
                  onChangeSelectedAggField(
                    selectedOptions.length === 1 ? selectedOptions[0].label : undefined
                  );
                  if (selectedOptions.length > 0) {
                    setAggFieldPopoverOpen(false);
                  }
                }}
              />
            </EuiFormRow>
          </EuiFlexItem>
        </EuiFlexGroup>
      </div>
    </EuiPopover>
  );
};

// eslint-disable-next-line import/no-default-export
export { OfExpression as default };
