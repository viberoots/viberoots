NativeLinkInfo = provider(fields = [
    "library",
    "link_kind",
    "link_name",
    "runtime_outputs",
])

def native_runtime_outputs(deps):
    outputs = []
    seen = {}
    for dep in deps:
        if NativeLinkInfo in dep:
            for output in dep[NativeLinkInfo].runtime_outputs:
                key = str(output)
                if key not in seen:
                    seen[key] = True
                    outputs.append(output)
        if DefaultInfo not in dep:
            continue
        for output in dep[DefaultInfo].default_outputs:
            key = str(output)
            if key not in seen:
                seen[key] = True
                outputs.append(output)
    return outputs

__all__ = ["NativeLinkInfo", "native_runtime_outputs"]
