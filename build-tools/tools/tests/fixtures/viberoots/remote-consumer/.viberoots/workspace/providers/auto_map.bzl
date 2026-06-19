MODULE_PROVIDERS = {}

def _provider_impl(_ctx):
    return [DefaultInfo()]

provider_fixture = rule(impl = _provider_impl, attrs = {})
