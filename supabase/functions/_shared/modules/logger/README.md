# Logger

Logger structuré minimal pour les runtimes Edge. Les champs de corrélation sont
réservés et `serializeError` borne les valeurs, gère les cycles et masque les
clés usuelles contenant des secrets ou des capacités Eventflow.
