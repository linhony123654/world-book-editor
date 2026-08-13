export function recommendSettings(semanticType, functionType) {
  const fields = {
    key: [],
    constant: false,
    selective: false,
    position: 0,
    depth: 4,
    order: 100,
    probability: 100
  };

  if (functionType === 'constant_background') {
    fields.constant = true;
    fields.position = 0;
    fields.order = semanticType === 'rule' ? 80 : 100;
  }
  if (functionType === 'voice_constraint') {
    fields.constant = true;
    fields.position = 4;
    fields.depth = 2;
  }
  if (functionType === 'hidden_fact') {
    fields.constant = false;
    fields.position = 4;
    fields.depth = 4;
  }
  if (semanticType === 'event' || functionType === 'plot_hook') {
    fields.position = 4;
    fields.depth = 4;
  }
  return fields;
}
