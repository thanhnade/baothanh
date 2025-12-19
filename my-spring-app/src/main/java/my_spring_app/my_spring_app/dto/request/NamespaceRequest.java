package my_spring_app.my_spring_app.dto.request;

import java.util.Map;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class NamespaceRequest {

    @NotBlank(message = "Tên namespace không được để trống")
    @Size(min = 1, max = 63, message = "Tên namespace phải có độ dài từ 1 đến 63 ký tự")
    @Pattern(
        regexp = "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$",
        message = "Tên namespace chỉ được chứa chữ thường, số và dấu gạch nối, phải bắt đầu và kết thúc bằng chữ hoặc số"
    )
    private String name;

    private Map<String, String> labels;

    private Map<String, String> annotations;
}

