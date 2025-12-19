package my_spring_app.my_spring_app.dto.request;

import java.util.Map;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class NamespaceUpdateRequest {

    private Map<String, String> labels;

    private Map<String, String> annotations;
}
